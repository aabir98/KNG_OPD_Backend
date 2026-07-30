const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const swaggerUi = require('swagger-ui-express');
const swaggerDocument = require('./swagger.json');

const app = express();
const port = 5000;

app.use(cors());
app.use(express.json());
// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Ensure directories exist
const DATA_DIR = path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
const TEMP_DIR = path.join(__dirname, 'temp');

Promise.all([
    fs.mkdir(DATA_DIR, { recursive: true }),
    fs.mkdir(PUBLIC_DIR, { recursive: true }),
    fs.mkdir(TEMP_DIR, { recursive: true })
]).catch(console.error);

const upload = multer({ dest: TEMP_DIR });

// Utilities
async function readJson(filename) {
    try {
        const data = await fs.readFile(path.join(DATA_DIR, filename), 'utf-8');
        return JSON.parse(data);
    } catch (e) {
        return [];
    }
}

async function writeJson(filename, data) {
    await fs.writeFile(path.join(DATA_DIR, filename), JSON.stringify(data, null, 2), 'utf-8');
}

// ---------------------------------------------------------
// ROOT / DOCUMENTATION ROUTE
// ---------------------------------------------------------
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

app.get('/', (req, res) => {
    res.json({
        message: "Welcome to the Ray's Medical Backend API",
        status: "Running",
        documentation_url: "http://localhost:5000/docs",
        endpoints: {
            announcement: "/api/announcement (GET, POST)",
            doctors: "/api/doctors (GET, POST, PATCH, DELETE)",
            bookings: "/api/admin/bookings (GET, PATCH, DELETE)",
            users: "/api/users (GET, POST)",
            tests: "/api/tests (GET, POST, PATCH, DELETE)",
            gallery: "/api/gallery (GET, POST, PATCH, DELETE)",
            blog: "/api/blog (GET)"
        }
    });
});

// ---------------------------------------------------------
// ANNOUNCEMENT ROUTES
// ---------------------------------------------------------
app.get('/api/announcement', async (req, res) => {
    try {
        const announcements = await readJson('announcements.json');
        res.json({ success: true, announcements });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to read announcements' });
    }
});

app.post('/api/announcement', async (req, res) => {
    try {
        const { text } = req.body;
        if (!text) return res.status(400).json({ success: false, message: 'Text is required' });

        const announcements = await readJson('announcements.json');
        const newAnnouncement = {
            id: crypto.randomUUID(),
            text,
            createdAt: new Date().toISOString()
        };

        announcements.unshift(newAnnouncement);
        await writeJson('announcements.json', announcements);
        res.json({ success: true, announcement: newAnnouncement, announcements });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update announcement' });
    }
});

// ---------------------------------------------------------
// DOCTORS ROUTES
// ---------------------------------------------------------
app.get('/api/doctors', async (req, res) => {
    try {
        const doctors = await readJson('doctors.json');
        res.json(doctors);
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to read doctors' });
    }
});

app.post('/api/doctors', upload.single('image'), async (req, res) => {
    try {
        const { name, specialty, description, experience } = req.body;
        let imageurl = req.body.imageurl;
        let availableDays = [];
        let availableWeeks = [];
        try { if (req.body.availableDays) availableDays = JSON.parse(req.body.availableDays); } catch(e){}
        try { if (req.body.availableWeeks) availableWeeks = JSON.parse(req.body.availableWeeks); } catch(e){}

        if (req.file) {
            const uploadDir = path.join(PUBLIC_DIR, 'doctors');
            await fs.mkdir(uploadDir, { recursive: true });
            
            const ext = req.file.originalname.split('.').pop() || 'png';
            const filename = `doc_${Date.now()}.${ext}`;
            const filePath = path.join(uploadDir, filename);
            
            await fs.copyFile(req.file.path, filePath);
            await fs.unlink(req.file.path);
            
            imageurl = `/doctors/${filename}`;
        }

        const doctors = await readJson('doctors.json');
        const newDoctor = {
            id: crypto.randomUUID(),
            name,
            specialty,
            description: description || '',
            experience: experience || '',
            imageurl: imageurl || 'https://lh3.googleusercontent.com/aida-public/AB6AXuBmxD5QtlBvuaxjE9RyFgYHeEPJFGVX4i18ppQ6CNbIvROAey7gi6vMWqdJEO-sLTn_L1DMGV5R_DJkzd4wFKqAeCcwZJwwGKw_XeY1B2cRdfRhlxSl6KsIuuPyCmh_d86z-LMnbEztd5bKd2ai0b0Yxlkh7l8rmuYuGsq-kpce_16cOAUzYokO8y6XuQklukfPFkURThwZuKMYBmini0-C3ksQkpKsTnLe2ydERUnDA3H8FoYCH13NAmG0NfoCeOqzCWArUvicIoAJ',
            availableDays,
            availableWeeks,
            dummyRating: req.body.dummyRating || '',
            useDummyRating: req.body.useDummyRating === 'true',
            createdAt: new Date().toISOString()
        };

        doctors.unshift(newDoctor);
        await writeJson('doctors.json', doctors);
        res.json({ success: true, doctor: newDoctor });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Failed to add doctor' });
    }
});

app.patch('/api/doctors', upload.single('image'), async (req, res) => {
    try {
        const { id, name, specialty, description, experience } = req.body;
        if (!id) return res.status(400).json({ success: false, message: 'Doctor ID required' });

        const doctors = await readJson('doctors.json');
        const doctorIndex = doctors.findIndex(d => d.id === id || String(d.id) === id);

        if (doctorIndex === -1) return res.status(404).json({ success: false, message: 'Doctor not found' });

        const doctor = doctors[doctorIndex];
        if (name) doctor.name = name;
        if (specialty) doctor.specialty = specialty;
        if (description !== undefined) doctor.description = description;
        if (experience !== undefined) doctor.experience = experience;
        if (req.body.dummyRating !== undefined) doctor.dummyRating = req.body.dummyRating;
        if (req.body.useDummyRating !== undefined) doctor.useDummyRating = req.body.useDummyRating === 'true';
        
        if (req.body.availableDays) {
            try { doctor.availableDays = JSON.parse(req.body.availableDays); } catch(e){}
        }
        if (req.body.availableWeeks) {
            try { doctor.availableWeeks = JSON.parse(req.body.availableWeeks); } catch(e){}
        }

        if (req.file) {
            const uploadDir = path.join(PUBLIC_DIR, 'doctors');
            await fs.mkdir(uploadDir, { recursive: true });
            
            const ext = req.file.originalname.split('.').pop() || 'png';
            const filename = `doc_${Date.now()}.${ext}`;
            const filePath = path.join(uploadDir, filename);
            
            await fs.copyFile(req.file.path, filePath);
            await fs.unlink(req.file.path);
            
            doctor.imageurl = `/doctors/${filename}`;
        }

        doctors[doctorIndex] = doctor;
        await writeJson('doctors.json', doctors);
        res.json({ success: true, doctor });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Failed to update doctor' });
    }
});

app.delete('/api/doctors', async (req, res) => {
    try {
        const id = req.query.id;
        if (!id) return res.status(400).json({ success: false, message: 'Doctor ID required' });

        const doctors = await readJson('doctors.json');
        const filtered = doctors.filter(d => d.id !== id && String(d.id) !== id);
        
        await writeJson('doctors.json', filtered);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to delete doctor' });
    }
});

// ---------------------------------------------------------
// SUBMIT ROUTE (Google Sheets integration)
// ---------------------------------------------------------
app.post('/api/submit', async (req, res) => {
    try {
        const data = req.body;
        const timestamp = new Date().toISOString();
        const GOOGLE_SHEET_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbzpYuGb1FPCr3JU_AZHOXzJaRt6gupkw9NX3w9Xr4I4_2O4xGBIF_G9-loZ7OGqQd5T/exec";
        
        let bookings = await readJson('bookings.json');
        
        const isPathology = data.type === "Home Collection Request";
        const prefix = isPathology ? "RAY-PAT-" : "RAY-DOC-";
        let bookingNumber = "";
        let isUnique = false;
        
        while (!isUnique) {
            const randomNumber = Math.floor(1000 + Math.random() * 9000).toString();
            bookingNumber = prefix + randomNumber;
            if (!bookings.some(b => b.bookingNumber === bookingNumber)) {
                isUnique = true;
            }
        }

        const newBooking = {
            id: crypto.randomUUID(),
            bookingNumber,
            ...data,
            createdAt: timestamp,
        };

        bookings.push(newBooking);
        await writeJson('bookings.json', bookings);

        try {
            const response = await fetch(GOOGLE_SHEET_WEBHOOK_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...data, timestamp: new Date().toLocaleString() })
            });
            if (!response.ok) console.warn("Failed to send data to Google Sheets.");
        } catch (sheetError) {
            console.error("Google Sheets Webhook Error:", sheetError);
        }

        res.json({ success: true, message: "Booking confirmed and saved to database!" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "There was an error processing your request." });
    }
});

// ---------------------------------------------------------
// BLOG ROUTE
// ---------------------------------------------------------
app.get('/api/blog', async (req, res) => {
    try {
        const scriptUrl = "https://script.google.com/macros/s/AKfycbzpYuGb1FPCr3JU_AZHOXzJaRt6gupkw9NX3w9Xr4I4_2O4xGBIF_G9-loZ7OGqQd5T/exec?tab=Blog";
        const response = await fetch(scriptUrl);
        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to fetch blog posts" });
    }
});

// ---------------------------------------------------------
// BOOKINGS / ADMIN ROUTES
// ---------------------------------------------------------
app.get('/api/admin/bookings', async (req, res) => {
    try {
        const bookings = await readJson('bookings.json');
        bookings.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        res.json({ success: true, bookings });
    } catch (error) {
        res.status(500).json({ success: false, message: "Error retrieving booking history" });
    }
});

app.get('/api/bookings', async (req, res) => {
    try {
        const email = req.query.email;
        const id = req.query.id;
        const bookings = await readJson('bookings.json');
        let filtered = bookings;
        if (email) filtered = bookings.filter(b => b.userEmail === email);
        if (id) filtered = bookings.filter(b => b.id === id);
        res.json({ success: true, bookings: filtered });
    } catch (error) {
        res.status(500).json({ success: false, message: "Error retrieving bookings" });
    }
});

app.delete('/api/bookings', async (req, res) => {
    try {
        const id = req.query.id;
        if (!id) return res.status(400).json({ success: false, message: "Missing id" });

        const bookings = await readJson('bookings.json');
        const updated = bookings.map(b => b.id === id ? { ...b, status: "Deleted" } : b);
        await writeJson('bookings.json', updated);
        res.json({ success: true, message: "Booking cancelled" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Error deleting booking" });
    }
});

app.patch('/api/admin/bookings', async (req, res) => {
    try {
        const { id, newDate, status } = req.body;
        if (!id || (!newDate && !status)) return res.status(400).json({ success: false, message: "Missing fields" });

        let bookings = await readJson('bookings.json');
        let found = false;
        
        bookings = bookings.map(b => {
            if (b.id === id) {
                found = true;
                return { ...b, ...(newDate && { date: newDate }), ...(status && { status }) };
            }
            return b;
        });

        if (!found) return res.status(404).json({ success: false, message: "Booking not found" });
        await writeJson('bookings.json', bookings);
        res.json({ success: true, message: "Booking updated" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Error updating booking" });
    }
});

app.delete('/api/admin/bookings', async (req, res) => {
    try {
        const id = req.query.id;
        if (!id) return res.status(400).json({ success: false, message: "Missing id" });

        let bookings = await readJson('bookings.json');
        let found = false;
        
        bookings = bookings.map(b => {
            if (b.id === id) {
                found = true;
                return { ...b, status: "Deleted" };
            }
            return b;
        });

        if (!found) return res.status(404).json({ success: false, message: "Booking not found" });
        await writeJson('bookings.json', bookings);
        res.json({ success: true, message: "Booking deleted" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Error deleting booking" });
    }
});

app.post('/api/admin/bookings/upload', upload.single('file'), async (req, res) => {
    try {
        const { id, type } = req.body;
        if (!id || !type || !req.file) return res.status(400).json({ success: false, message: "Missing fields" });

        const uploadDir = path.join(PUBLIC_DIR, 'uploads');
        await fs.mkdir(uploadDir, { recursive: true });

        const ext = req.file.originalname.split('.').pop() || 'pdf';
        const filename = `${id}-${type}-${Date.now()}.${ext}`;
        const filePath = path.join(uploadDir, filename);

        await fs.copyFile(req.file.path, filePath);
        await fs.unlink(req.file.path);
        
        const fileUrl = `/uploads/${filename}`;
        
        let bookings = await readJson('bookings.json');
        let found = false;
        bookings = bookings.map(b => {
            if (b.id === id) {
                found = true;
                if (type === "bill") b.billUrl = fileUrl;
                if (type === "report") b.reportUrl = fileUrl;
            }
            return b;
        });

        if (!found) {
            await fs.unlink(filePath).catch(()=>console.log);
            return res.status(404).json({ success: false, message: "Booking not found" });
        }

        await writeJson('bookings.json', bookings);
        res.json({ success: true, message: "Uploaded", fileUrl });
    } catch (error) {
        res.status(500).json({ success: false, message: "Upload failed" });
    }
});

// ---------------------------------------------------------
// USERS ROUTE
// ---------------------------------------------------------
app.get('/api/users', async (req, res) => {
    try {
        const users = await readJson('users.json');
        const email = req.query.email;
        
        if (email) {
            const user = users.find(u => u.email === email);
            if (user) {
                return res.json({ success: true, user });
            } else {
                return res.json({ success: false, message: "User not found" });
            }
        }
        
        res.json({ success: true, users });
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to fetch users" });
    }
});

app.post('/api/users', async (req, res) => {
    try {
        const data = req.body;
        let users = await readJson('users.json');
        
        const existing = users.find(u => u.email === data.email);
        if (existing) {
            return res.json({ success: true, message: "Login successful", user: existing });
        }

        const newUser = {
            id: crypto.randomUUID(),
            ...data,
            createdAt: new Date().toISOString()
        };
        
        users.push(newUser);
        await writeJson('users.json', users);
        res.json({ success: true, message: "User created", user: newUser });
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to login/register" });
    }
});

app.put('/api/users', async (req, res) => {
    try {
        const { email, phone } = req.body;
        if (!email || !phone) {
            return res.status(400).json({ success: false, message: "Missing email or phone" });
        }
        
        let users = await readJson('users.json');
        const userIndex = users.findIndex(u => u.email === email);
        
        if (userIndex !== -1) {
            users[userIndex].phone = phone;
            await writeJson('users.json', users);
            return res.json({ success: true, message: "Phone number updated", user: users[userIndex] });
        } else {
            return res.status(404).json({ success: false, message: "User not found" });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to update user" });
    }
});

// ---------------------------------------------------------
// REVIEWS ROUTE
// ---------------------------------------------------------
app.get('/api/reviews', async (req, res) => {
    try {
        const reviews = await readJson('reviews.json');
        const doctor = req.query.doctor;
        if (doctor) {
            res.json({ success: true, reviews: reviews.filter(r => r.doctorName === doctor) });
        } else {
            res.json({ success: true, reviews });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: "Error retrieving reviews" });
    }
});

app.post('/api/reviews', async (req, res) => {
    try {
        const { bookingId, doctorName, patientName, patientEmail, rating, text, type } = req.body;
        const reviewType = type || 'Doctor';

        if (!bookingId || !patientEmail || rating === undefined) {
            return res.status(400).json({ success: false, message: "Missing required review fields" });
        }
        if (reviewType === 'Doctor' && !doctorName) {
            return res.status(400).json({ success: false, message: "Doctor name required for doctor reviews" });
        }
        
        let reviews = await readJson('reviews.json');
        
        // Prevent duplicate reviews for the same booking
        if (reviews.find(r => r.bookingId === bookingId)) {
            return res.status(400).json({ success: false, message: "Review already exists for this booking" });
        }

        const newReview = {
            id: crypto.randomUUID(),
            bookingId,
            type: reviewType,
            doctorName: doctorName || null,
            patientName,
            patientEmail,
            rating,
            text: text || "",
            createdAt: new Date().toISOString()
        };
        
        reviews.push(newReview);
        await writeJson('reviews.json', reviews);
        res.json({ success: true, review: newReview });
    } catch (error) {
        res.status(500).json({ success: false, message: "Error saving review" });
    }
});

app.patch('/api/reviews', async (req, res) => {
    try {
        const { id, text, featured } = req.body;
        if (!id) return res.status(400).json({ success: false, message: "Review ID required" });
        
        let reviews = await readJson('reviews.json');
        const idx = reviews.findIndex(r => r.id === id);
        if (idx === -1) return res.status(404).json({ success: false, message: "Review not found" });
        
        if (text !== undefined) reviews[idx].text = text;
        if (featured !== undefined) reviews[idx].featured = featured === 'true' || featured === true;
        
        await writeJson('reviews.json', reviews);
        res.json({ success: true, review: reviews[idx] });
    } catch (error) {
        res.status(500).json({ success: false, message: "Error updating review" });
    }
});

app.delete('/api/reviews', async (req, res) => {
    try {
        const id = req.query.id;
        if (!id) return res.status(400).json({ success: false, message: "Review ID required" });
        
        let reviews = await readJson('reviews.json');
        reviews = reviews.filter(r => r.id !== id);
        await writeJson('reviews.json', reviews);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: "Error deleting review" });
    }
});

// ---------------------------------------------------------
// TESTS ROUTE
// ---------------------------------------------------------
app.get('/api/tests', async (req, res) => {
    try {
        const tests = await readJson('tests.json');
        res.json(tests);
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to read tests" });
    }
});

app.post('/api/tests', async (req, res) => {
    try {
        const data = req.body;
        const tests = await readJson('tests.json');
        const newTest = {
            id: crypto.randomUUID(),
            name: data.name,
            code: data.code,
            createdAt: new Date().toISOString()
        };
        tests.unshift(newTest);
        await writeJson('tests.json', tests);
        res.json({ success: true, test: newTest });
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to add test" });
    }
});

app.patch('/api/tests', async (req, res) => {
    try {
        const data = req.body;
        if (!data.id) return res.status(400).json({ success: false, message: "Test ID required" });
        
        const tests = await readJson('tests.json');
        const idx = tests.findIndex(t => t.id === data.id);
        if (idx === -1) return res.status(404).json({ success: false, message: "Test not found" });
        
        tests[idx] = { ...tests[idx], name: data.name, code: data.code };
        await writeJson('tests.json', tests);
        res.json({ success: true, test: tests[idx] });
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to update test" });
    }
});

app.delete('/api/tests', async (req, res) => {
    try {
        const id = req.query.id;
        if (!id) return res.status(400).json({ success: false, message: "Test ID required" });
        
        let tests = await readJson('tests.json');
        tests = tests.filter(t => t.id !== id);
        await writeJson('tests.json', tests);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to delete test" });
    }
});

// ---------------------------------------------------------
// GALLERY ROUTE
// ---------------------------------------------------------
app.get('/api/gallery', async (req, res) => {
    try {
        const items = await readJson('gallery.json');
        res.json(items);
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to read gallery" });
    }
});

app.post('/api/gallery', upload.single('image'), async (req, res) => {
    try {
        const { title, description } = req.body;
        let imageurl = req.body.imageurl;

        if (req.file) {
            const uploadDir = path.join(PUBLIC_DIR, 'gallery');
            await fs.mkdir(uploadDir, { recursive: true });
            const ext = req.file.originalname.split('.').pop() || 'png';
            const filename = `gal_${Date.now()}.${ext}`;
            const filePath = path.join(uploadDir, filename);
            await fs.copyFile(req.file.path, filePath);
            await fs.unlink(req.file.path);
            imageurl = `/gallery/${filename}`;
        }

        const items = await readJson('gallery.json');
        const newItem = {
            id: crypto.randomUUID(),
            title,
            description: description || '',
            imageurl: imageurl || '',
            createdAt: new Date().toISOString()
        };

        items.unshift(newItem);
        await writeJson('gallery.json', items);
        res.json({ success: true, item: newItem });
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to add gallery item" });
    }
});

app.patch('/api/gallery', upload.single('image'), async (req, res) => {
    try {
        const { id, title, description } = req.body;
        if (!id) return res.status(400).json({ success: false, message: "Gallery ID required" });

        const items = await readJson('gallery.json');
        const idx = items.findIndex(i => i.id === id);
        if (idx === -1) return res.status(404).json({ success: false, message: "Item not found" });
        
        let item = items[idx];
        if (title) item.title = title;
        if (description !== undefined) item.description = description;

        if (req.file) {
            const uploadDir = path.join(PUBLIC_DIR, 'gallery');
            await fs.mkdir(uploadDir, { recursive: true });
            const ext = req.file.originalname.split('.').pop() || 'png';
            const filename = `gal_${Date.now()}.${ext}`;
            const filePath = path.join(uploadDir, filename);
            await fs.copyFile(req.file.path, filePath);
            await fs.unlink(req.file.path);
            item.imageurl = `/gallery/${filename}`;
        }
        
        items[idx] = item;
        await writeJson('gallery.json', items);
        res.json({ success: true, item });
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to update gallery item" });
    }
});

app.delete('/api/gallery', async (req, res) => {
    try {
        const id = req.query.id;
        if (!id) return res.status(400).json({ success: false, message: "Gallery ID required" });
        
        let items = await readJson('gallery.json');
        items = items.filter(i => i.id !== id);
        await writeJson('gallery.json', items);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to delete gallery item" });
    }
});


app.listen(port, () => {
    console.log(`Backend server listening on port ${port}`);
});
