import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import mysql from 'mysql2/promise';
import bodyParser from 'body-parser';
import cors from 'cors';
import multer from 'multer';
import nodemailer from 'nodemailer';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Permitir solicitudes desde todos los orígenes
        methods: ["GET", "POST"]
    }
});

app.use(bodyParser.json());




const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    waitForConnections: true,
    connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT, 10) || 50,
    queueLimit: parseInt(process.env.DB_QUEUE_LIMIT, 10) || 0
});

// Claves de cifrado
const algorithm = 'aes-256-cbc';
const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex'); // Leer la clave de la variable de entorno y convertirla a un Buffer

const encrypt = (text) => {
    const iv = crypto.randomBytes(16); // Generar un IV aleatorio para cada cifrado
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    console.log('Encrypting: 1', { text, iv: iv.toString('hex'), key: key.toString('hex') });
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return { iv: iv.toString('hex'), encryptedData: encrypted.toString('hex') };
};

const decrypt = (text) => {
    const iv = Buffer.from(text.iv, 'hex');
    const encryptedText = Buffer.from(text.encryptedData, 'hex');
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    console.log('Decrypting: 2', { iv: text.iv, encryptedData: text.encryptedData, key: key.toString('hex') });
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
};

io.on('connection', (socket) => {
    console.log('New client connected');

    socket.on('join', async ({ sender, receiver }) => {
        socket.join(`${sender}-${receiver}`);
        socket.join(`${receiver}-${sender}`);

        try {
            const [results] = await pool.query(`
                SELECT message.*, users.name AS sender_username, users.profile_photo AS sender_profile_photo
                FROM message
                JOIN users ON message.sender_id = users.id
                WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
                ORDER BY timestamp
            `, [sender, receiver, receiver, sender]);

            // Desencriptar los mensajes
            const decryptedResults = results.map(result => {
                if (result.iv && result.content) {
                    const decryptedContent = decrypt({ iv: result.iv, encryptedData: result.content });
                    return { ...result, content: decryptedContent };
                }
                return result;
            });
            socket.emit('load messages', decryptedResults);
        } catch (err) {
            console.error('Error al cargar los mensajes:', err);
        }
    });

    socket.on('send message', async (message) => {
        const { sender_id, receiver_id, content, reply_to } = message;
        try {
            // Encriptar el mensaje
            const encryptedContent = encrypt(content);

            const [result] = await pool.query('INSERT INTO message (sender_id, receiver_id, content, iv, reply_to) VALUES (?, ?, ?, ?, ?)', [sender_id, receiver_id, encryptedContent.encryptedData, encryptedContent.iv, reply_to]);
            const newMessage = { id: result.insertId, sender_id, receiver_id, content, reply_to, timestamp: new Date() };

            // Desencriptar el mensaje antes de enviarlo al cliente
            const decryptedMessage = { ...newMessage, content: decrypt({ iv: encryptedContent.iv, encryptedData: encryptedContent.encryptedData }) };

            io.to(`${sender_id}-${receiver_id}`).emit('messages', decryptedMessage);
        } catch (err) {
            console.error('Error al enviar el mensaje:', err);
        }
    });

    socket.on('get last message', async ({ sender, receiver }) => {
        try {
            const [results] = await pool.query(
                `SELECT *
                FROM message
                WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
                ORDER BY timestamp DESC
                LIMIT 1;`,
                [sender, receiver, receiver, sender]
            );
            if (results.length > 0) {
                const decryptedContent = decrypt({ iv: results[0].iv, encryptedData: results[0].content });
                const lastMessage = { ...results[0], content: decryptedContent };
                socket.emit('last message', lastMessage);
            } else {
                socket.emit('last message', null);
            }
        } catch (err) {
            console.error('Error al obtener el último mensaje:', err);
        }
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });
});


nodemailer.createTestAccount((err, account) => {
    if (err) {
        console.error('Error al crear la cuenta de prueba de Ethereal:', err);
        return;
    }
    // Crear un transportador de correo usando Ethereal
    const transporter = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        auth: {
            user: 'abagail69@ethereal.email',
            pass: 'bmHjRm132Me7YX6NJJ'
        }
    });

    app.post('/request-email-verification', async (req, res) => {
        const { userId, email } = req.body;

        // Generar un token único
        const token = crypto.randomBytes(20).toString('hex');

        // Establecer una fecha de expiración para el token (por ejemplo, 1 hora)
        const expirationDate = new Date(Date.now() + 120 * 60 * 1000); // 1 hora desde ahora

        try {
            // Actualizar el usuario en la base de datos con el token y la fecha de expiración
            await pool.query('UPDATE users SET email_verification_token = ?, email_verification_expiration = ? WHERE id = ?', [token, expirationDate, userId]);

            // Configurar el correo electrónico
            const mailOptions = {
                from: 'no-reply@tuapp.com',
                to: email,
                subject: 'Verificación de correo electrónico',
                html: `<p>Por favor, verifica tu correo electrónico haciendo clic en el siguiente enlace:</p>
                    <a href="https://aution.vercel.app/verify-email?token=${token}">Verificar correo electrónico</a>
                    <p>El enlace expira en 1 hora.</p>`
            };
            // Enviar el correo electrónico
            transporter.sendMail(mailOptions, (error, info) => {
                if (error) {
                    console.error('Error al enviar el correo:', error);
                    return res.status(500).send('Error al enviar el correo de verificación');
                }
                res.status(200).send('Correo de verificación enviado');
            });
            } catch (error) {
                console.error('Error al solicitar verificación de correo:', error);
                res.status(500).send('Error del servidor');
            }
        });
    // Endpoint para verificar el correo electrónico
    app.get('/verify-email', async (req, res) => {
        const { token } = req.query;
        try {
            // Verificar si el token existe y no ha expirado
            const [results] = await pool.query('SELECT id FROM users WHERE email_verification_token = ?', [token]);
            if (results.length > 0) {
                const userId = results[0].id;
                // Actualizar al usuario para marcar el correo como verificado
                await pool.query('UPDATE users SET email_verified = 1, email_verification_token = NULL, email_verification_expiration = NULL WHERE id = ?', [userId]);
                res.send('¡Correo electrónico verificado con éxito!');
            } else {
                res.status(400).send('Token inválido o expirado');
            }
        } catch (error) {
            console.error('Error al verificar el correo electrónico:', error);
            res.status(500).send('Error del servidor');
        }
    });
});


const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

// Configurar multer para guardar archivos
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/uploads/');
    },
    filename: (req, file, cb) => {
        const filename = `${Date.now()}-${file.originalname.replace(/ /g, '-')}`; // Reemplazar espacios con guiones
        cb(null, filename);
    }
});


const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // Limitar el tamaño del archivo a 5MB
    fileFilter: (req, file, cb) => {
        const filetypes = /jpeg|jpg|png/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());

        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error('Tipo de archivo no soportado. Solo se permiten JPEG, JPG y PNG.'));
    }
});

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));


// Endpoint para subir la foto de perfil
app.post('/user/upload-profile-photo', upload.single('profile_photo'), async (req, res) => {
    const { userId } = req.body;
    const profilePhotoPath = `/uploads/${req.file.filename}`; // Ajuste aquí para obtener la ruta correcta
    try {
        await pool.query('UPDATE users SET profile_photo = ? WHERE id = ?', [profilePhotoPath, userId]);
        res.status(200).send('Profile photo updated successfully');
    } catch (err) {
        console.error('Error al subir la foto de perfil:', err);
        res.status(500).send('Server error');
    }
});

// Endpoint para obtener datos del perfil del usuario
app.get('/user/profile', async (req, res) => {
    const { userId } = req.query;
    try {
        const [results] = await pool.query('SELECT id, name, email, residence, phone, profile_photo, email_verified FROM users WHERE id = ?', [userId]);
        if (results.length > 0) {
            const user = results[0];
            // Ajustar la ruta de la imagen para que sea completa
            if (user.profile_photo) {
                user.profile_photo = `https://backend-auction-app-web.vercel.app${user.profile_photo.replace(/ /g, '%20')}`; // Reemplazar espacios con %20
            }
            res.json(user);
        } else {
            res.status(404).send('User not found');
        }
    } catch (err) {
        console.error('Error al obtener el perfil del usuario:', err);
        res.status(500).send('Server error');
    }
});

app.get('/contacts', async (req, res) => {
    const { userId } = req.query;
    try {
        const [results] = await pool.query(`
            SELECT id, name, profile_photo
            FROM users WHERE id != ?
        `, userId);
        res.json(results);
    } catch (err) {
        console.error('Error al obtener los contactos:', err);
        res.status(500).send('Server error');
    }
});



app.post('/user/update', async (req, res) => {
    const { userId, email, residence, phone } = req.body;
    try {
        await pool.query('UPDATE users SET email = ?, residence = ?, phone = ? WHERE id = ?', [email, residence, phone, userId]);
        res.status(200).send('Profile updated successfully');
    } catch (err) {
        console.error('Error al actualizar el usuario:', err);
        res.status(500).send('Server error');
    }
});



app.post('/newPost', upload.array('images', 10), async (req, res) => {
    const { title, description, price, seller_id} = req.body;
    const images = req.files ? req.files.map(file => `/uploads/${file.filename}`) : [];
    try {
        const [result] = await pool.query(
            'INSERT INTO posts (title, description, price, seller_id) VALUES (?, ?, ?, ?)',
            [title, description, price, seller_id]
        );

        const postId = result.insertId;

        // Insertar las imágenes en una tabla separada
        for (const image of images) {
            await pool.query('INSERT INTO post_images (post_id, image_url) VALUES (?, ?)', [postId, image]);
        }

        const newPost = { id: postId, title, description, price, seller_id, images };
        res.status(201).json(newPost);
    } catch (error) {
        console.error('Error al guardar la publicación:', error);
        res.status(500).send('Error del servidor');
    }
});

app.get('/posts', async (req, res) => {
    try {
        const [results] = await pool.query(`
            SELECT posts.*, users.name AS seller_name, users.profile_photo AS seller_photo
            FROM posts
            JOIN users ON posts.seller_id = users.id
            ORDER BY date_Post DESC
        `);
        const [images] = await pool.query('SELECT * FROM post_images');
        const posts = results.map(post => {
            const postImages = images.filter(image => image.post_id === post.id_post).map(image => image.image_url);
            return { ...post, images: postImages };
        });
        res.json(posts);
    } catch (error) {
        console.error('Error al obtener las publicaciones:', error);
        res.status(500).send('Error del servidor');
    }
});

app.get('/myPosts', async (req, res) => {
    const  userId  = req.query.id;
    try {
        const [results] = await pool.query(`
            SELECT posts.*, users.name AS seller_name, users.profile_photo AS seller_photo
            FROM posts
            JOIN users ON posts.seller_id = users.id
            WHERE seller_id = ?
            ORDER BY date_Post DESC
        `, userId);
        const [images] = await pool.query('SELECT * FROM post_images');
        const posts = results.map(post => {
            const postImages = images.filter(image => image.post_id === post.id_post).map(image => image.image_url);
            return { ...post, images: postImages };
        });
        res.json(posts);
    }
    catch (error) {
        console.error('Error al obtener las publicaciones:', error);
        res.status(500).send('Error del servidor');
    }
});

app.post('/changeBid', async (req, res) => {
    const { lastPrice, actualPrice, postId } = req.body;
    try {
        await pool.query('UPDATE posts SET actual_price = ?, last_price = ? WHERE id_post = ?', [actualPrice, lastPrice, postId]);
        res.status(200).send('Bid placed successfully');
    } catch (error) {
        console.error('Error al cambiar la oferta:', error);
        res.status(500).send('Error del servidor');
    }
})

server.listen(process.env.PORT || 3000, () => {
    console.log(`Listening on port ${process.env.PORT || 3000}`);
});