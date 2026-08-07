const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const Razorpay = require('razorpay');
const swaggerUi = require('swagger-ui-express');

const razorpay = new Razorpay({
  key_id: "rzp_test_TMcZxvkXaGAFoK",
  key_secret: "dXM8BdSmQE8KFnr8CndGadDg"
});
const swaggerDocument = require('./swagger.json');

const app = express();
const port = 5001;

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
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
let dbPromise = open({ filename: path.join(__dirname, 'data', 'database.sqlite'), driver: sqlite3.Database });

const JSON_FIELDS = {
    bookings: ['selectedTests'], doctors: ['availableDays', 'availableWeeks'], events: ['images'],
    medicine_orders: ['patientDetails', 'items', 'cart'], notifications: ['details'], user_notifications: ['readBy', 'clearedBy']
};
const BOOLEAN_FIELDS = {
    announcements: ['isActive'], doctors: ['useDummyRating'], medicines: ['inStock', 'isPrescriptionRequired'],
    medicine_coupons: ['isActive'], pathology_coupons: ['isActive'], reviews: ['featured'], user_notifications: ['isRead']
};

async function readJson(filename) {
    const table = filename.replace('.json', '');
    try {
        const db = await dbPromise;
        const rows = await db.all('SELECT * FROM ' + table);
        return rows.map(row => {
            const parsed = { ...row };
            if (JSON_FIELDS[table]) {
                for (const field of JSON_FIELDS[table]) {
                    if (parsed[field]) try { parsed[field] = JSON.parse(parsed[field]); } catch(e){}
                }
            }
            if (BOOLEAN_FIELDS[table]) {
                for (const field of BOOLEAN_FIELDS[table]) {
                    if (parsed[field] !== null && parsed[field] !== undefined) parsed[field] = parsed[field] === 1;
                }
            }
            return parsed;
        });
    } catch (e) {
        console.error('Error reading from sqlite:', e);
        return [];
    }
}

async function writeJson(filename, data) {
    const table = filename.replace('.json', '');
    try {
        const db = await dbPromise;
        const tableInfo = await db.all('PRAGMA table_info(' + table + ')');
        const validColumns = tableInfo.map(c => c.name);
        
        await db.run('BEGIN TRANSACTION');
        await db.run('DELETE FROM ' + table);
        
        for (const row of data) {
            const keys = Object.keys(row).filter(k => validColumns.includes(k));
            if (keys.length === 0) continue;
            
            const values = keys.map(k => {
                let val = row[k];
                if (typeof val === 'boolean') return val ? 1 : 0;
                if (typeof val === 'object' && val !== null) return JSON.stringify(val);
                return val;
            });
            const placeholders = keys.map(() => '?').join(', ');
            const cols = keys.map(k => `"${k}"`).join(', ');
            await db.run(`INSERT INTO ${table} (${cols}) VALUES (${placeholders})`, ...values);
        }
        await db.run('COMMIT');
    } catch(e) {
        console.error('Error writing to sqlite:', e);
        const db = await dbPromise;
        await db.run('ROLLBACK').catch(()=>"");
    }
}

async function addUserNotification(phone, type, title, message) {
    try {
        const notifications = await readJson('user_notifications.json');
        const newNotif = {
            id: crypto.randomUUID(),
            phone,
            type,
            title,
            message,
            createdAt: new Date().toISOString(),
            isRead: false,
            readBy: []
        };
        notifications.unshift(newNotif);
        await writeJson('user_notifications.json', notifications);
    } catch (error) {
        console.error("Error saving user notification:", error);
    }
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
            medicines: "/api/medicines (GET, POST, PATCH, DELETE)",
            notifications: "/api/notifications (GET, POST, PATCH)",
            userNotifications: "/api/user/notifications (GET, POST)"
        }
    });
});

// ---------------------------------------------------------
// USER NOTIFICATIONS ROUTE
// ---------------------------------------------------------
app.get('/api/user/notifications', async (req, res) => {
    try {
        const { phone } = req.query;
        let notifications = await readJson('user_notifications.json');
        
        // Filter: global ("all") OR matching phone
        notifications = notifications.filter(n => {
            const isTarget = n.phone === 'all' || (phone && n.phone === phone);
            const isCleared = n.clearedBy && n.clearedBy.includes(phone || 'guest');
            return isTarget && !isCleared;
        });
        
        // Sort newest first
        notifications.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        
        res.json({ success: true, notifications });
    } catch (error) {
        console.error("Error fetching user notifications:", error);
        res.status(500).json({ success: false, message: 'Failed to fetch user notifications' });
    }
});

app.post('/api/user/notifications/read', async (req, res) => {
    try {
        const { id, phone } = req.body;
        if (!id || !phone) return res.status(400).json({ success: false, message: 'Missing id or phone' });
        
        let notifications = await readJson('user_notifications.json');
        let index = notifications.findIndex(n => n.id === id);
        
        if (index !== -1) {
            if (notifications[index].phone === 'all') {
                if (!notifications[index].readBy) notifications[index].readBy = [];
                if (!notifications[index].readBy.includes(phone)) {
                    notifications[index].readBy.push(phone);
                }
            } else {
                notifications[index].isRead = true;
            }
            await writeJson('user_notifications.json', notifications);
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error("Error marking notification as read:", error);
        res.status(500).json({ success: false, message: 'Failed to update notification' });
    }
});

// ---------------------------------------------------------
app.post('/api/user/notifications/clear', async (req, res) => {
    try {
        const { id, phone, clearAll } = req.body;
        if (!phone) return res.status(400).json({ success: false, message: 'Missing phone' });
        
        let notifications = await readJson('user_notifications.json');
        
        if (clearAll) {
            // Clear all notifications for this phone
            notifications = notifications.filter(n => {
                if (n.phone === 'all') {
                    if (!n.clearedBy) n.clearedBy = [];
                    if (!n.clearedBy.includes(phone)) n.clearedBy.push(phone);
                    return true; // Keep the global one, but we marked it cleared
                } else if (n.phone === phone) {
                    return false; // Remove personal notification
                }
                return true;
            });
        } else if (id) {
            const index = notifications.findIndex(n => n.id === id);
            if (index !== -1) {
                if (notifications[index].phone === 'all') {
                    if (!notifications[index].clearedBy) notifications[index].clearedBy = [];
                    if (!notifications[index].clearedBy.includes(phone)) notifications[index].clearedBy.push(phone);
                } else if (notifications[index].phone === phone) {
                    notifications.splice(index, 1);
                }
            }
        }
        
        await writeJson('user_notifications.json', notifications);
        res.json({ success: true });
    } catch (error) {
        console.error("Error clearing notification(s):", error);
        res.status(500).json({ success: false, message: 'Failed to clear notifications' });
    }
});

// ---------------------------------------------------------
// ANNOUNCEMENT ROUTE
// ---------------------------------------------------------
app.get('/api/announcement', async (req, res) => {
    try {
        const announcements = await readJson('announcements.json');
        if (req.query.all === 'true') {
            res.json({ success: true, announcements });
        } else {
            const activeOnly = announcements.filter(a => a.isActive !== false);
            res.json({ success: true, announcements: activeOnly });
        }
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
            isActive: true,
            createdAt: new Date().toISOString()
        };

        announcements.unshift(newAnnouncement);
        await writeJson('announcements.json', announcements);
        
        await addUserNotification('all', 'announcement', 'New Announcement', text);
        
        res.json({ success: true, announcement: newAnnouncement, announcements });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update announcement' });
    }
});

app.patch('/api/announcement', async (req, res) => {
    try {
        const { id, text, isActive } = req.body;
        if (!id) return res.status(400).json({ success: false, message: 'ID is required' });

        let announcements = await readJson('announcements.json');
        const index = announcements.findIndex(a => a.id === id);
        if (index === -1) return res.status(404).json({ success: false, message: 'Announcement not found' });

        if (text !== undefined) announcements[index].text = text;
        if (isActive !== undefined) announcements[index].isActive = isActive;

        await writeJson('announcements.json', announcements);
        res.json({ success: true, announcement: announcements[index], announcements });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to patch announcement' });
    }
});

app.delete('/api/announcement', async (req, res) => {
    try {
        const id = req.query.id || req.body.id;
        if (!id) return res.status(400).json({ success: false, message: 'ID is required' });

        let announcements = await readJson('announcements.json');
        announcements = announcements.filter(a => a.id !== id);
        await writeJson('announcements.json', announcements);
        res.json({ success: true, announcements });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to delete announcement' });
    }
});

// ---------------------------------------------------------
// NOTIFICATION ROUTES
// ---------------------------------------------------------
const addNotification = async ({ type, title, message, details }) => {
    try {
        let notifications = await readJson('notifications.json');
        const newNotification = {
            id: crypto.randomUUID(),
            type, // "doctor_appointment" | "pathology_test" | "medicine_order"
            title,
            message,
            details: details || {},
            isRead: false,
            createdAt: new Date().toISOString()
        };
        notifications.unshift(newNotification);
        await writeJson('notifications.json', notifications);
        return newNotification;
    } catch (e) {
        console.error("Error adding notification:", e);
    }
};

app.get('/api/notifications', async (req, res) => {
    try {
        const notifications = await readJson('notifications.json');
        const unreadCount = notifications.filter(n => !n.isRead).length;
        res.json({ success: true, notifications, unreadCount });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch notifications' });
    }
});

app.patch('/api/notifications/read', async (req, res) => {
    try {
        const { id, markAll } = req.body;
        let notifications = await readJson('notifications.json');
        
        if (markAll) {
            notifications = notifications.map(n => ({ ...n, isRead: true }));
        } else if (id) {
            notifications = notifications.map(n => n.id === id ? { ...n, isRead: true } : n);
        }
        
        await writeJson('notifications.json', notifications);
        const unreadCount = notifications.filter(n => !n.isRead).length;
        res.json({ success: true, notifications, unreadCount });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update notification' });
    }
});

app.delete('/api/notifications', async (req, res) => {
    try {
        const { id, deleteAll } = req.query;
        let notifications = await readJson('notifications.json');
        
        if (deleteAll === 'true') {
            notifications = [];
        } else if (id) {
            notifications = notifications.filter(n => n.id !== id);
        }
        
        await writeJson('notifications.json', notifications);
        res.json({ success: true, notifications, unreadCount: 0 });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to delete notification' });
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
// RAZORPAY ROUTES
// ---------------------------------------------------------
app.post('/api/create-order', async (req, res) => {
    try {
        const options = {
            amount: 1 * 100, // Rs 1
            currency: "INR",
            receipt: "receipt_" + Math.random().toString(36).substring(7)
        };
        const order = await razorpay.orders.create(options);
        res.json({ success: true, order });
    } catch (error) {
        console.error("Razorpay order error:", error);
        res.status(500).json({ success: false, message: "Error creating order" });
    }
});

app.post('/api/verify-payment', async (req, res) => {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
        const sign = razorpay_order_id + "|" + razorpay_payment_id;
        const expectedSign = crypto.createHmac("sha256", "dXM8BdSmQE8KFnr8CndGadDg")
                                   .update(sign.toString())
                                   .digest("hex");

        if (razorpay_signature === expectedSign) {
            return res.json({ success: true, message: "Payment verified successfully" });
        } else {
            return res.status(400).json({ success: false, message: "Invalid signature sent!" });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: "Error verifying payment" });
    }
});

// ---------------------------------------------------------
// SUBMIT ROUTE (Google Sheets integration)
// ---------------------------------------------------------
app.post('/api/submit', upload.single('prescription'), async (req, res) => {
    try {
        let data = req.body;
        if (typeof req.body.bookingData === 'string') {
            try { data = JSON.parse(req.body.bookingData); } catch (e) {}
        }
        
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

        let prescriptionUrl = data.prescriptionUrl || "";
        if (req.file) {
            const uploadDir = path.join(PUBLIC_DIR, 'prescriptions');
            await fs.mkdir(uploadDir, { recursive: true });
            const ext = req.file.originalname.split('.').pop() || 'png';
            const filename = `presc_${bookingNumber}_${Date.now()}.${ext}`;
            const filePath = path.join(uploadDir, filename);
            await fs.copyFile(req.file.path, filePath);
            await fs.unlink(req.file.path);
            prescriptionUrl = `/prescriptions/${filename}`;
        }

        const newBooking = {
            id: crypto.randomUUID(),
            bookingNumber,
            ...data,
            prescriptionUrl,
            createdAt: timestamp,
        };

        bookings.push(newBooking);
        await writeJson('bookings.json', bookings);

        // Send admin notification
        if (isPathology) {
            await addNotification({
                type: "pathology_test",
                title: "New Pathology Test Booking",
                message: `Patient ${data.name || 'User'} requested Home Collection for ${data.date || 'a date'} (${data.timeSlot || ''}). Phone: ${data.phone || 'N/A'}`,
                details: { bookingNumber, name: data.name, date: data.date, timeSlot: data.timeSlot, phone: data.phone }
            });
        } else {
            const docName = data.doctor ? (data.doctor.startsWith("Dr.") ? data.doctor : `Dr. ${data.doctor}`) : "a doctor";
            await addNotification({
                type: "doctor_appointment",
                title: "New Doctor Appointment",
                message: `Patient ${data.name || 'User'} booked ${docName} for ${data.date || 'a date'}. Phone: ${data.phone || 'N/A'}`,
                details: { bookingNumber, name: data.name, doctor: data.doctor, date: data.date, phone: data.phone }
            });
        }
        
        await addUserNotification(data.userPhone || data.phone || 'all', 'order_placed', 'Booking Confirmed', `Your ${isPathology ? 'Pathology' : 'Doctor'} booking (${bookingNumber}) has been confirmed.`);

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
        const phone = req.query.phone;
        const id = req.query.id;
        const bookings = await readJson('bookings.json');
        
        let filtered = bookings;
        if (id) {
            filtered = bookings.filter(b => b.id === id);
        } else if (email && email !== 'undefined' && phone && phone !== 'undefined') {
            filtered = bookings.filter(b => b.userEmail === email || b.userPhone === phone || b.phone === phone);
        } else if (email && email !== 'undefined') {
            filtered = bookings.filter(b => b.userEmail === email);
        } else if (phone && phone !== 'undefined') {
            filtered = bookings.filter(b => b.userPhone === phone || b.phone === phone);
        }

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
        const { id, newDate, status, selectedTests } = req.body;
        if (!id) return res.status(400).json({ success: false, message: "Missing id" });

        let bookings = await readJson('bookings.json');
        let found = false;
        
        bookings = bookings.map(b => {
            if (b.id === id) {
                found = true;
                return { 
                    ...b, 
                    ...(newDate && { date: newDate }), 
                    ...(status && { status }),
                    ...(selectedTests !== undefined && { selectedTests })
                };
            }
            return b;
        });

        if (!found) return res.status(404).json({ success: false, message: "Booking not found" });
        await writeJson('bookings.json', bookings);

        if (status === 'Completed') {
            const booking = bookings.find(b => b.id === id);
            if (booking) {
                await addUserNotification(booking.userPhone || booking.phone || 'all', 'order_completed', 'Booking Completed', `Your booking (${id}) has been completed.`);
            }
        }

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
        const { bookingId, doctorName, patientName, patientEmail, patientPhone, rating, text, type } = req.body;
        const reviewType = type || 'Doctor';

        if (!bookingId || (!patientEmail && !patientPhone) || rating === undefined) {
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
            patientPhone,
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
        if (featured !== undefined) {
            const isFeatured = featured === 'true' || featured === true;
            reviews[idx].featured = isFeatured;
        }
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
// MEDICINES ROUTE
// ---------------------------------------------------------
app.get('/api/medicines', async (req, res) => {
    try {
        const medicines = await readJson('medicines.json');
        res.json(medicines);
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to read medicines" });
    }
});

app.post('/api/medicines', upload.single('image'), async (req, res) => {
    try {
        const { name, price, category, originalPrice, description, inStock, isPrescriptionRequired } = req.body;
        let imageurl = req.body.imageurl;

        if (req.file) {
            const uploadDir = path.join(PUBLIC_DIR, 'medicines');
            await fs.mkdir(uploadDir, { recursive: true });
            const ext = req.file.originalname.split('.').pop() || 'png';
            const filename = `med_${Date.now()}.${ext}`;
            const filePath = path.join(uploadDir, filename);
            await fs.copyFile(req.file.path, filePath);
            await fs.unlink(req.file.path);
            imageurl = `/medicines/${filename}`;
        }

        const medicines = await readJson('medicines.json');
        const newMedicine = {
            id: crypto.randomUUID(),
            name,
            price: Number(price) || 0,
            originalPrice: originalPrice ? Number(originalPrice) : undefined,
            category: category || "General Care",
            description: description || "",
            inStock: inStock !== 'false' && inStock !== false,
            isPrescriptionRequired: isPrescriptionRequired === 'true' || isPrescriptionRequired === true,
            imageurl: imageurl || '',
            createdAt: new Date().toISOString()
        };

        medicines.unshift(newMedicine);
        await writeJson('medicines.json', medicines);
        res.json({ success: true, medicine: newMedicine });
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to add medicine" });
    }
});

app.patch('/api/medicines', upload.single('image'), async (req, res) => {
    try {
        const { id, name, price, category, originalPrice, description, inStock, isPrescriptionRequired } = req.body;
        if (!id) return res.status(400).json({ success: false, message: "Medicine ID required" });

        const medicines = await readJson('medicines.json');
        const idx = medicines.findIndex(m => m.id === id);
        if (idx === -1) return res.status(404).json({ success: false, message: "Medicine not found" });
        
        let med = medicines[idx];
        if (name !== undefined) med.name = name;
        if (price !== undefined) med.price = Number(price) || 0;
        if (originalPrice !== undefined) med.originalPrice = originalPrice ? Number(originalPrice) : undefined;
        if (category !== undefined) med.category = category;
        if (description !== undefined) med.description = description;
        if (inStock !== undefined) med.inStock = inStock === 'true' || inStock === true;
        if (isPrescriptionRequired !== undefined) med.isPrescriptionRequired = isPrescriptionRequired === 'true' || isPrescriptionRequired === true;

        if (req.file) {
            const uploadDir = path.join(PUBLIC_DIR, 'medicines');
            await fs.mkdir(uploadDir, { recursive: true });
            const ext = req.file.originalname.split('.').pop() || 'png';
            const filename = `med_${Date.now()}.${ext}`;
            const filePath = path.join(uploadDir, filename);
            await fs.copyFile(req.file.path, filePath);
            await fs.unlink(req.file.path);
            med.imageurl = `/medicines/${filename}`;
        }
        
        medicines[idx] = med;
        await writeJson('medicines.json', medicines);
        res.json({ success: true, medicine: med });
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to update medicine" });
    }
});

app.delete('/api/medicines', async (req, res) => {
    try {
        const id = req.query.id;
        if (!id) return res.status(400).json({ success: false, message: "Medicine ID required" });
        
        let medicines = await readJson('medicines.json');
        medicines = medicines.filter(m => m.id !== id);
        await writeJson('medicines.json', medicines);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to delete medicine" });
    }
});

// ---------------------------------------------------------
// GALLERY ROUTE
// ---------------------------------------------------------
app.get('/api/gallery', async (req, res) => {
    try {
        const items = await readJson('gallery.json');
        const normalized = items.map(item => ({
            ...item,
            src: item.src || item.imageurl || '',
            imageurl: item.imageurl || item.src || ''
        }));
        res.json(normalized);
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to read gallery" });
    }
});

app.post('/api/gallery', upload.single('image'), async (req, res) => {
    try {
        const { title, description } = req.body;
        let imageurl = req.body.imageurl || req.body.src;

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

        const finalUrl = imageurl || '';
        const items = await readJson('gallery.json');
        const newItem = {
            id: crypto.randomUUID(),
            title: title || '',
            description: description || '',
            imageurl: finalUrl,
            src: finalUrl,
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
        if (title !== undefined) item.title = title;
        if (description !== undefined) item.description = description;

        if (req.file) {
            const uploadDir = path.join(PUBLIC_DIR, 'gallery');
            await fs.mkdir(uploadDir, { recursive: true });
            const ext = req.file.originalname.split('.').pop() || 'png';
            const filename = `gal_${Date.now()}.${ext}`;
            const filePath = path.join(uploadDir, filename);
            await fs.copyFile(req.file.path, filePath);
            await fs.unlink(req.file.path);
            const newUrl = `/gallery/${filename}`;
            item.imageurl = newUrl;
            item.src = newUrl;
        } else {
            item.src = item.src || item.imageurl || '';
            item.imageurl = item.imageurl || item.src || '';
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
// ---------------------------------------------------------
// EVENTS ROUTES
// ---------------------------------------------------------
app.get('/api/events', async (req, res) => {
    try {
        const items = await readJson('events.json');
        res.json(items);
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to fetch events" });
    }
});

app.post('/api/events', upload.array('images', 10), async (req, res) => {
    try {
        const { title, date, details } = req.body;
        
        let imageUrls = [];
        if (req.files && req.files.length > 0) {
            const uploadDir = path.join(PUBLIC_DIR, 'events');
            await fs.mkdir(uploadDir, { recursive: true });
            
            for (let i = 0; i < req.files.length; i++) {
                const file = req.files[i];
                const filename = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
                const filePath = path.join(uploadDir, filename);
                await fs.rename(file.path, filePath);
                imageUrls.push(`/events/${filename}`);
            }
        }
        
        const newItem = {
            id: crypto.randomUUID(),
            title,
            date,
            details,
            images: imageUrls,
            createdAt: new Date().toISOString()
        };
        
        let items = await readJson('events.json');
        items.unshift(newItem);
        await writeJson('events.json', items);
        
        await addUserNotification('all', 'event', 'New Event', title);
        
        res.json({ success: true, event: newItem });
    } catch (error) {
        console.error("Error in POST /api/events:", error);
        res.status(500).json({ success: false, message: "Failed to add event", error: error.message });
    }
});

app.patch('/api/events', upload.array('images', 10), async (req, res) => {
    try {
        const { id, title, date, details, keepImages } = req.body;
        
        let items = await readJson('events.json');
        const index = items.findIndex(i => i.id === id);
        
        if (index === -1) {
            return res.status(404).json({ success: false, message: "Event not found" });
        }

        // Process retained images from existing ones
        let finalImages = [];
        let keepArray = [];
        if (keepImages) {
            try { keepArray = JSON.parse(keepImages); } catch (e) { keepArray = typeof keepImages === 'string' ? [keepImages] : keepImages || []; }
        }
        
        const existingImages = items[index].images || [];
        for (const oldImg of existingImages) {
            if (keepArray.includes(oldImg)) {
                finalImages.push(oldImg);
            } else {
                try {
                    const oldPath = path.join(PUBLIC_DIR, oldImg.replace('/events/', 'events/'));
                    await fs.unlink(oldPath);
                } catch (e) {}
            }
        }
        
        // Add new images
        if (req.files && req.files.length > 0) {
            const uploadDir = path.join(PUBLIC_DIR, 'events');
            await fs.mkdir(uploadDir, { recursive: true });
            
            for (let i = 0; i < req.files.length; i++) {
                const file = req.files[i];
                const filename = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
                const filePath = path.join(uploadDir, filename);
                await fs.rename(file.path, filePath);
                finalImages.push(`/events/${filename}`);
            }
        }
        
        items[index] = { ...items[index], title, date, details, images: finalImages };
        await writeJson('events.json', items);
        
        res.json({ success: true, event: items[index] });
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to update event" });
    }
});

app.delete('/api/events', async (req, res) => {
    try {
        const { id } = req.query;
        let items = await readJson('events.json');
        const event = items.find(i => i.id === id);
        
        if (event && event.images) {
            for (const img of event.images) {
                try {
                    const imgPath = path.join(PUBLIC_DIR, img.replace('/events/', 'events/'));
                    await fs.unlink(imgPath);
                } catch (e) {}
            }
        }
        
        items = items.filter(i => i.id !== id);
        await writeJson('events.json', items);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to delete event" });
    }
});

// ---------------------------------------------------------
// MEDICINE ORDERS ROUTES
// ---------------------------------------------------------
app.post('/api/medicine-orders', upload.single('prescription'), async (req, res) => {
    try {
        let orderData = req.body;
        if (typeof req.body.orderData === 'string') {
            try { orderData = JSON.parse(req.body.orderData); } catch (e) {}
        }
        
        let orders = await readJson('medicine_orders.json');
        
        // Generate a unique order number
        let orderNumber = "";
        let isUnique = false;
        while (!isUnique) {
            const randomNumber = Math.floor(1000 + Math.random() * 9000).toString();
            orderNumber = "RAY-MED-" + randomNumber;
            if (!orders.some(o => o.id === orderNumber)) {
                isUnique = true;
            }
        }

        let prescriptionUrl = orderData.prescriptionUrl || "";
        if (req.file) {
            const uploadDir = path.join(PUBLIC_DIR, 'prescriptions');
            await fs.mkdir(uploadDir, { recursive: true });
            const ext = req.file.originalname.split('.').pop() || 'png';
            const filename = `presc_${orderNumber}_${Date.now()}.${ext}`;
            const filePath = path.join(uploadDir, filename);
            await fs.copyFile(req.file.path, filePath);
            await fs.unlink(req.file.path);
            prescriptionUrl = `/prescriptions/${filename}`;
        }

        const newOrder = {
            id: orderNumber,
            ...orderData,
            prescriptionUrl: prescriptionUrl,
            status: "Placed",
            createdAt: new Date().toISOString()
        };

        orders.unshift(newOrder);
        await writeJson('medicine_orders.json', orders);
        
        await addNotification({
            type: "medicine_order",
            title: "New Medicine Order",
            message: `Order #${orderNumber}: ${newOrder.patientDetails?.name || 'User'} ordered ${newOrder.items?.length || 0} item(s) • Total ₹${newOrder.finalAmount || newOrder.subtotal || 0}.${prescriptionUrl ? ' (Prescription Attached)' : ''} Phone: ${newOrder.patientDetails?.phone || newOrder.userPhone || 'N/A'}`,
            details: { orderId: orderNumber, name: newOrder.patientDetails?.name, total: newOrder.finalAmount || newOrder.subtotal, phone: newOrder.patientDetails?.phone, hasPrescription: !!prescriptionUrl }
        });

        const userPhone = newOrder.userPhone || newOrder.patientDetails?.phone || 'all';
        await addUserNotification(userPhone, 'order_placed', 'Medicine Order Placed', `Your medicine order (#${orderNumber}) has been placed successfully.`);

        res.json({ success: true, order: newOrder });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Failed to place medicine order' });
    }
});

app.get('/api/medicine-orders', async (req, res) => {
    try {
        const phone = req.query.phone;
        let orders = await readJson('medicine_orders.json');
        
        if (phone) {
            orders = orders.filter(o => (o.userPhone === phone || (o.patientDetails && o.patientDetails.phone === phone)) && o.status !== 'Deleted');
        }
        
        res.json(orders);
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to fetch medicine orders" });
    }
});

app.put('/api/medicine-orders', async (req, res) => {
    try {
        const { id, status } = req.body;
        if (!id || !status) return res.status(400).json({ success: false, message: 'Missing id or status' });
        
        let orders = await readJson('medicine_orders.json');
        const index = orders.findIndex(o => o.id === id);
        if (index !== -1) {
            orders[index].status = status;
            await writeJson('medicine_orders.json', orders);

            if (status === 'Completed' || status === 'Delivered') {
                const userPhone = orders[index].userPhone || orders[index].patientDetails?.phone || 'all';
                await addUserNotification(userPhone, 'order_completed', 'Order Delivered', `Your medicine order (#${id}) has been marked as ${status}.`);
            }

            res.json({ success: true, order: orders[index] });
        } else {
            res.status(404).json({ success: false, message: 'Order not found' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update order' });
    }
});

app.delete('/api/medicine-orders', async (req, res) => {
    try {
        const { id, permanent } = req.query;
        if (!id) return res.status(400).json({ success: false, message: 'Missing id' });

        let orders = await readJson('medicine_orders.json');
        const index = orders.findIndex(o => o.id === id);

        if (index === -1) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        if (permanent === 'true' || permanent === true) {
            orders = orders.filter(o => o.id !== id);
            await writeJson('medicine_orders.json', orders);
            return res.json({ success: true, message: 'Order permanently deleted' });
        }

        // Soft delete to recycle bin
        orders[index].previousStatus = (orders[index].status && orders[index].status !== 'Deleted') ? orders[index].status : 'Placed';
        orders[index].status = 'Deleted';

        await writeJson('medicine_orders.json', orders);
        res.json({ success: true, message: 'Order moved to recycle bin' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to delete order' });
    }
});

app.post('/api/medicine-orders/restore', async (req, res) => {
    try {
        const { id } = req.body;
        if (!id) return res.status(400).json({ success: false, message: 'Missing id' });

        let orders = await readJson('medicine_orders.json');
        const index = orders.findIndex(o => o.id === id);

        if (index === -1) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        const restoredStatus = orders[index].previousStatus || 'Placed';
        orders[index].status = restoredStatus;
        delete orders[index].previousStatus;

        await writeJson('medicine_orders.json', orders);
        res.json({ success: true, message: 'Order restored successfully', order: orders[index] });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to restore order' });
    }
});

app.post('/api/medicine-orders/upload', upload.single('bill'), async (req, res) => {
    try {
        const { id } = req.body;
        if (!id || !req.file) return res.status(400).json({ success: false, message: "Missing id or file" });

        const uploadDir = path.join(PUBLIC_DIR, 'uploads');
        await fs.mkdir(uploadDir, { recursive: true });

        const ext = req.file.originalname.split('.').pop() || 'pdf';
        const filename = `bill-${id}-${Date.now()}.${ext}`;
        const filePath = path.join(uploadDir, filename);

        await fs.copyFile(req.file.path, filePath);
        await fs.unlink(req.file.path);

        const billUrl = `/uploads/${filename}`;

        let orders = await readJson('medicine_orders.json');
        const index = orders.findIndex(o => o.id === id);
        if (index !== -1) {
            orders[index].billUrl = billUrl;
            await writeJson('medicine_orders.json', orders);
            res.json({ success: true, billUrl });
        } else {
            res.status(404).json({ success: false, message: 'Order not found' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: "Error uploading bill" });
    }
});

// ==================== COUPONS API ====================

const syncCouponToAnnouncement = async (coupon, serviceName) => {
    try {
        if (!coupon || !coupon.code) return;
        const codeUpper = coupon.code.toUpperCase();
        const discNum = Number(coupon.discount) || 0;
        const discStr = coupon.discountType === 'percentage' ? `${discNum}% OFF` : `₹${discNum} OFF`;
        
        let desc = coupon.description;
        if (!desc) {
            desc = `${codeUpper}: Get ${discStr} on ${serviceName}!`;
            const details = [];
            if (coupon.minOrder) details.push(`Min Order ₹${coupon.minOrder}`);
            if (coupon.discountType === 'percentage' && coupon.maxDiscount) details.push(`Max Discount ₹${coupon.maxDiscount}`);
            if (coupon.validTo) details.push(`Valid till ${coupon.validTo}`);
            if (details.length > 0) desc += ` (${details.join(', ')})`;
        } else if (!desc.toUpperCase().startsWith(codeUpper)) {
            desc = `${codeUpper}: ${desc}`;
        }

        let announcements = await readJson('announcements.json');
        
        const idx = announcements.findIndex(a => 
            (a.couponId && a.couponId === coupon.id) || 
            (a.couponCode && a.couponCode === codeUpper) ||
            (a.text && a.text.toUpperCase().startsWith(codeUpper))
        );

        const isActiveState = coupon.isActive !== false;

        if (idx !== -1) {
            announcements[idx].text = desc;
            announcements[idx].isActive = isActiveState;
            announcements[idx].couponId = coupon.id;
            announcements[idx].couponCode = codeUpper;
        } else if (isActiveState) {
            announcements.unshift({
                id: crypto.randomUUID(),
                couponId: coupon.id,
                couponCode: codeUpper,
                text: desc,
                isActive: true,
                createdAt: new Date().toISOString()
            });
        }

        await writeJson('announcements.json', announcements);
    } catch (e) {
        console.error("Error syncing coupon to announcement:", e);
    }
};

const deleteCouponAnnouncement = async (couponId, couponCode) => {
    try {
        let announcements = await readJson('announcements.json');
        const codeUpper = couponCode ? couponCode.toUpperCase() : '';
        announcements = announcements.filter(a => !(a.couponId === couponId || (codeUpper && (a.couponCode === codeUpper || a.text?.toUpperCase().startsWith(codeUpper)))));
        await writeJson('announcements.json', announcements);
    } catch (e) {
        console.error("Error deleting coupon announcement:", e);
    }
};

// GET all medicine coupons
app.get('/api/coupons/medicine', async (req, res) => {
    try {
        const coupons = await readJson('medicine_coupons.json');
        res.json(coupons);
    } catch (error) {
        res.status(500).json({ success: false, message: "Error fetching medicine coupons" });
    }
});

// POST new medicine coupon
app.post('/api/coupons/medicine', async (req, res) => {
    try {
        const { code, discount, discountType, minOrder, maxDiscount, validFrom, validTo, description, isActive } = req.body;
        const codeUpper = code ? code.toUpperCase() : '';
        const discNum = Number(discount) || 0;
        const discStr = (discountType === 'percentage' || discountType === '%') ? `${discNum}% OFF` : `₹${discNum} OFF`;

        let autoDesc = description;
        if (!autoDesc) {
            autoDesc = `${codeUpper}: Get ${discStr} on Medicines!`;
            const details = [];
            if (minOrder && Number(minOrder) > 0) details.push(`Min Order ₹${minOrder}`);
            if ((discountType === 'percentage' || discountType === '%') && maxDiscount && Number(maxDiscount) > 0) details.push(`Max Discount ₹${maxDiscount}`);
            if (validTo) details.push(`Valid till ${validTo}`);
            if (details.length > 0) autoDesc += ` (${details.join(', ')})`;
        } else if (!autoDesc.toUpperCase().startsWith(codeUpper)) {
            autoDesc = `${codeUpper}: ${autoDesc}`;
        }

        const newCoupon = {
            id: crypto.randomUUID(),
            code: codeUpper,
            discount: discNum,
            discountType: discountType || 'percentage',
            minOrder: Number(minOrder) || 0,
            maxDiscount: Number(maxDiscount) || 0,
            validFrom,
            validTo,
            description: autoDesc,
            isActive: isActive !== false,
            createdAt: new Date().toISOString()
        };
        let coupons = await readJson('medicine_coupons.json');
        coupons.unshift(newCoupon);
        await writeJson('medicine_coupons.json', coupons);
        
        await syncCouponToAnnouncement(newCoupon, 'Medicines');
        await addUserNotification('all', 'coupon', 'New Coupon Available', autoDesc);
        
        res.json({ success: true, coupon: newCoupon });
    } catch (error) {
        console.error("Error adding medicine coupon:", error);
        res.status(500).json({ success: false, message: "Failed to add medicine coupon" });
    }
});

// PATCH update medicine coupon
app.patch('/api/coupons/medicine', async (req, res) => {
    try {
        const { id, ...updates } = req.body;
        let coupons = await readJson('medicine_coupons.json');
        const index = coupons.findIndex(c => c.id === id);
        if (index === -1) return res.status(404).json({ success: false, message: "Coupon not found" });
        if (updates.code) updates.code = updates.code.toUpperCase();
        if (updates.discount) updates.discount = Number(updates.discount);
        if (updates.minOrder) updates.minOrder = Number(updates.minOrder);
        if (updates.maxDiscount) updates.maxDiscount = Number(updates.maxDiscount);

        const targetCode = updates.code || coupons[index].code;
        const targetDiscount = updates.discount !== undefined ? updates.discount : coupons[index].discount;
        const targetDiscType = updates.discountType || coupons[index].discountType;
        const targetMin = updates.minOrder !== undefined ? updates.minOrder : coupons[index].minOrder;
        const targetMax = updates.maxDiscount !== undefined ? updates.maxDiscount : coupons[index].maxDiscount;
        const targetValidTo = updates.validTo !== undefined ? updates.validTo : coupons[index].validTo;

        if (updates.description !== undefined && updates.description !== '') {
            if (!updates.description.toUpperCase().startsWith(targetCode.toUpperCase())) {
                updates.description = `${targetCode.toUpperCase()}: ${updates.description}`;
            }
        } else {
            const discStr = (targetDiscType === 'percentage' || targetDiscType === '%') ? `${targetDiscount}% OFF` : `₹${targetDiscount} OFF`;
            let autoDesc = `${targetCode.toUpperCase()}: Get ${discStr} on Medicines!`;
            const details = [];
            if (targetMin && Number(targetMin) > 0) details.push(`Min Order ₹${targetMin}`);
            if ((targetDiscType === 'percentage' || targetDiscType === '%') && targetMax && Number(targetMax) > 0) details.push(`Max Discount ₹${targetMax}`);
            if (targetValidTo) details.push(`Valid till ${targetValidTo}`);
            if (details.length > 0) autoDesc += ` (${details.join(', ')})`;
            updates.description = autoDesc;
        }

        coupons[index] = { ...coupons[index], ...updates };
        await writeJson('medicine_coupons.json', coupons);
        await syncCouponToAnnouncement(coupons[index], 'Medicines');
        res.json({ success: true, coupon: coupons[index] });
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to update medicine coupon" });
    }
});

// DELETE medicine coupon
app.delete('/api/coupons/medicine/:id', async (req, res) => {
    try {
        let coupons = await readJson('medicine_coupons.json');
        const target = coupons.find(c => c.id === req.params.id);
        coupons = coupons.filter(c => c.id !== req.params.id);
        await writeJson('medicine_coupons.json', coupons);
        if (target) {
            await deleteCouponAnnouncement(target.id, target.code);
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to delete medicine coupon" });
    }
});

// GET all pathology coupons
app.get('/api/coupons/pathology', async (req, res) => {
    try {
        const coupons = await readJson('pathology_coupons.json');
        res.json(coupons);
    } catch (error) {
        res.status(500).json({ success: false, message: "Error fetching pathology coupons" });
    }
});

// POST new pathology coupon
app.post('/api/coupons/pathology', async (req, res) => {
    try {
        const { code, discount, discountType, minOrder, maxDiscount, validFrom, validTo, description, isActive } = req.body;
        const codeUpper = code ? code.toUpperCase() : '';
        const discNum = Number(discount) || 0;
        const discStr = (discountType === 'percentage' || discountType === '%') ? `${discNum}% OFF` : `₹${discNum} OFF`;

        let autoDesc = description;
        if (!autoDesc) {
            autoDesc = `${codeUpper}: Get ${discStr} on Pathology Tests!`;
            const details = [];
            if (minOrder && Number(minOrder) > 0) details.push(`Min Order ₹${minOrder}`);
            if ((discountType === 'percentage' || discountType === '%') && maxDiscount && Number(maxDiscount) > 0) details.push(`Max Discount ₹${maxDiscount}`);
            if (validTo) details.push(`Valid till ${validTo}`);
            if (details.length > 0) autoDesc += ` (${details.join(', ')})`;
        } else if (!autoDesc.toUpperCase().startsWith(codeUpper)) {
            autoDesc = `${codeUpper}: ${autoDesc}`;
        }

        const newCoupon = {
            id: crypto.randomUUID(),
            code: codeUpper,
            discount: discNum,
            discountType: discountType || 'percentage',
            minOrder: Number(minOrder) || 0,
            maxDiscount: Number(maxDiscount) || 0,
            validFrom,
            validTo,
            description: autoDesc,
            isActive: isActive !== false,
            createdAt: new Date().toISOString()
        };
        let coupons = await readJson('pathology_coupons.json');
        coupons.unshift(newCoupon);
        await writeJson('pathology_coupons.json', coupons);
        
        await syncCouponToAnnouncement(newCoupon, 'Pathology Tests');
        await addUserNotification('all', 'coupon', 'New Coupon Available', autoDesc);
        
        res.json({ success: true, coupon: newCoupon });
    } catch (error) {
        console.error("Error adding pathology coupon:", error);
        res.status(500).json({ success: false, message: "Failed to add pathology coupon" });
    }
});

// PATCH update pathology coupon
app.patch('/api/coupons/pathology', async (req, res) => {
    try {
        const { id, ...updates } = req.body;
        let coupons = await readJson('pathology_coupons.json');
        const index = coupons.findIndex(c => c.id === id);
        if (index === -1) return res.status(404).json({ success: false, message: "Coupon not found" });
        if (updates.code) updates.code = updates.code.toUpperCase();
        if (updates.discount) updates.discount = Number(updates.discount);
        if (updates.minOrder) updates.minOrder = Number(updates.minOrder);
        if (updates.maxDiscount) updates.maxDiscount = Number(updates.maxDiscount);

        const targetCode = updates.code || coupons[index].code;
        const targetDiscount = updates.discount !== undefined ? updates.discount : coupons[index].discount;
        const targetDiscType = updates.discountType || coupons[index].discountType;
        const targetMin = updates.minOrder !== undefined ? updates.minOrder : coupons[index].minOrder;
        const targetMax = updates.maxDiscount !== undefined ? updates.maxDiscount : coupons[index].maxDiscount;
        const targetValidTo = updates.validTo !== undefined ? updates.validTo : coupons[index].validTo;

        if (updates.description !== undefined && updates.description !== '') {
            if (!updates.description.toUpperCase().startsWith(targetCode.toUpperCase())) {
                updates.description = `${targetCode.toUpperCase()}: ${updates.description}`;
            }
        } else {
            const discStr = (targetDiscType === 'percentage' || targetDiscType === '%') ? `${targetDiscount}% OFF` : `₹${targetDiscount} OFF`;
            let autoDesc = `${targetCode.toUpperCase()}: Get ${discStr} on Pathology Tests!`;
            const details = [];
            if (targetMin && Number(targetMin) > 0) details.push(`Min Order ₹${targetMin}`);
            if ((targetDiscType === 'percentage' || targetDiscType === '%') && targetMax && Number(targetMax) > 0) details.push(`Max Discount ₹${targetMax}`);
            if (targetValidTo) details.push(`Valid till ${targetValidTo}`);
            if (details.length > 0) autoDesc += ` (${details.join(', ')})`;
            updates.description = autoDesc;
        }

        coupons[index] = { ...coupons[index], ...updates };
        await writeJson('pathology_coupons.json', coupons);
        await syncCouponToAnnouncement(coupons[index], 'Pathology Tests');
        res.json({ success: true, coupon: coupons[index] });
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to update pathology coupon" });
    }
});

// DELETE pathology coupon
app.delete('/api/coupons/pathology/:id', async (req, res) => {
    try {
        let coupons = await readJson('pathology_coupons.json');
        const target = coupons.find(c => c.id === req.params.id);
        coupons = coupons.filter(c => c.id !== req.params.id);
        await writeJson('pathology_coupons.json', coupons);
        if (target) {
            await deleteCouponAnnouncement(target.id, target.code);
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to delete pathology coupon" });
    }
});


app.listen(port, () => {
    console.log(`Backend server listening on port ${port}`);
});
