import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import mysql from 'mysql2/promise';
import bodyParser from 'body-parser';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: ["http://localhost:5173", "https://aution.vercel.app"], // URLs permitidas
        methods: ["GET", "POST"],
        credentials: true // Si usas cookies o autenticación
    }
});

// Middleware
app.use(bodyParser.json());
app.use(cors({
    origin: ["http://localhost:5173", "https://aution.vercel.app"], // URLs permitidas
    methods: ["GET", "POST"],
    credentials: true
}));

// Configuración de la base de datos
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    waitForConnections: true,
    connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT, 10) || 50,
    queueLimit: parseInt(process.env.DB_QUEUE_LIMIT, 10) || 0
});

// Configuración de Socket.IO
io.on('connection', (socket) => {
    console.log('Nuevo cliente conectado:', socket.id);

    socket.on('join', async ({ sender, receiver }) => {
        socket.join(`${sender}-${receiver}`);
        socket.join(`${receiver}-${sender}`);
        console.log(`Salas unidas: ${sender}-${receiver} y ${receiver}-${sender}`);
    });

    socket.on('send message', async (message) => {
        console.log('Mensaje recibido:', message);
        // Aquí iría la lógica de encriptación y almacenamiento
    });

    socket.on('disconnect', () => {
        console.log('Cliente desconectado:', socket.id);
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
                    <a href="https://aution.vercel.app//verify-email?token=${token}">Verificar correo electrónico</a>
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
                user.profile_photo = `https://backend-auction-sigma.vercel.app/${user.profile_photo.replace(/ /g, '%20')}`; // Reemplazar espacios con %20
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