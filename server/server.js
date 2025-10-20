require('dotenv').config();
const express = require("express");
const cors = require('cors');
const path = require("path");
const bcrypt = require('bcryptjs');
const bodyParser = require('body-parser');
const mysql = require("mysql2/promise");
const multer = require('multer');
const fs = require('fs');
const app = express();

app.use(cors({
  origin: ['https://absen.ahoservice.my.id', 'https://admin.ahoservice.my.id', 'http://localhost:3000',],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.options('*', cors());

app.use(bodyParser.json());

const port = 3000;
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/admins');
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + ext;
    cb(null, uniqueName);
  }
});

const upload = multer({ storage });

app.use(express.static(path.join(__dirname, "..", "admin")));
app.use(express.static(path.join(__dirname, "..", 'assets')));
app.use('/uploads', express.static(path.join(__dirname, 'img')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, "..", "public")));
app.use(express.static(path.join(__dirname, "..", "setting")));
app.use(express.static(path.join(__dirname, 'AHOv2')));
app.use(express.json());

const db = mysql.createPool({
    host: "localhost",
    user: "root",
    password: "",
    database: "ahov2",
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

const { getVerifyAdminToken } = require('../middlewares/authMiddleware');
const verifyAdminToken = getVerifyAdminToken(db);

module.exports = db;

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "..", "index.html"));
});

let latestPoster = 'popupp.jpg'; // Default poster
let attendanceTime = {
    morningStart: '07:00',
    morningEnd: '08:00'
};

//========= Dashboard Admin =========//

app.post('/api/uploadPoster', upload.single('poster'), (req, res) => {
    const file = req.file;
    if (!file) {
        return res.status(400).json({ message: 'Tidak ada file yang diunggah' });
    }

    const imgDir = path.join(__dirname, 'img');

    // Hapus poster lama jika ada
    if (latestPoster) {
        const oldFilePath = path.join(imgDir, latestPoster);
        if (fs.existsSync(oldFilePath)) {
            fs.unlinkSync(oldFilePath);
        }
    }

    const newFileName = `poster_${Date.now()}${path.extname(file.originalname)}`;
    const newFilePath = path.join(imgDir, newFileName);

    fs.rename(file.path, newFilePath, (err) => {
        if (err) {
            console.error('Error saving file:', err);
            return res.status(500).json({ message: 'Gagal menyimpan file' });
        }

        // Update nama poster terbaru
        latestPoster = newFileName;
        res.json({ message: 'Poster berhasil diunggah', poster: newFileName });
    });
});

// Endpoint untuk mendapatkan poster terbaru
app.get('/api/getLatestPoster', (req, res) => {
    res.json({ poster: latestPoster });
});

// Endpoint untuk mendapatkan waktu absensi
app.get("/api/attendance-time", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT start_time, end_time FROM attendance_schedule LIMIT 1");
    if (rows.length === 0) {
      return res.status(404).json({ error: "Jadwal absen tidak ditemukan" });
    }
    res.json(rows[0]);
  } catch (error) {
    console.error("Error mengambil jadwal absen:", error);
    res.status(500).json({ error: "Gagal mengambil jadwal dari database" });
  }
});

// Endpoint untuk menyimpan waktu absensi
app.post("/api/attendance-time", async (req, res) => {
  const { start_time, end_time } = req.body;

  if (!start_time || !end_time) {
    return res.status(400).json({
      success: false,
      message: "Waktu mulai dan berakhir wajib diisi"
    });
  }

  try {
    const [existing] = await db.query("SELECT id FROM attendance_schedule LIMIT 1");

    if (existing.length === 0) {
      await db.query(
        "INSERT INTO attendance_schedule (start_time, end_time) VALUES (?, ?)",
        [start_time, end_time]
      );
    } else {
      await db.query(
        "UPDATE attendance_schedule SET start_time = ?, end_time = ? WHERE id = ?",
        [start_time, end_time, existing[0].id]
      );
    }

    res.json({ success: true, message: "Jadwal absensi berhasil diperbarui" });
  } catch (error) {
    console.error("Gagal update jadwal:", error);
    res.status(500).json({
      success: false,
      message: "Gagal update jadwal absensi"
    });
  }
});

// GET: Generate top 5 siswa terrajin
app.post('/api/leaderboard/generate', async (req, res) => {
    try {
        const { start_period, end_period } = req.body;
        
        if (!start_period || !end_period) {
            return res.status(400).json({
                success: false,
                message: 'Periode mulai dan akhir harus diisi'
            });
        }

        // Convert month input to date range
        const startDate = new Date(start_period + '-01');
        const endDate = new Date(end_period + '-01');
        endDate.setMonth(endDate.getMonth() + 1);
        endDate.setDate(endDate.getDate() - 1);

        // Query untuk menghitung total hari kerja dalam periode (optional)
        const totalDaysQuery = `
            SELECT COUNT(DISTINCT DATE(time)) as total_days 
            FROM attendance 
            WHERE time BETWEEN ? AND ?
        `;

        // Query untuk mendapatkan 5 siswa teratas
        const topStudentsQuery = `
            SELECT 
                name,
                class,
                COUNT(*) as attendance_count,
                ROUND((COUNT(*) / (SELECT COUNT(DISTINCT DATE(time)) FROM attendance WHERE time BETWEEN ? AND ?)) * 100, 2) as attendance_rate
            FROM attendance 
            WHERE time BETWEEN ? AND ?
            GROUP BY name, class 
            ORDER BY attendance_count DESC 
            LIMIT 5
        `;

        const [totalDaysResult] = await db.execute(totalDaysQuery, [startDate, endDate]);
        const [topStudents] = await db.execute(topStudentsQuery, [startDate, endDate, startDate, endDate]);

        res.json({
            success: true,
            data: topStudents,
            period: `${start_period} - ${end_period}`,
            total_days: totalDaysResult[0]?.total_days || 0
        });

    } catch (error) {
        console.error('Error generating leaderboard:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal generate leaderboard: ' + error.message
        });
    }
});

// POST: Simpan leaderboard ke database
app.post('/api/leaderboard/save', async (req, res) => {
    try {
        const { top_students, period, generated_at } = req.body;

        console.log('Saving leaderboard:', { period, student_count: top_students?.length });

        if (!top_students || !Array.isArray(top_students) || top_students.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Data siswa tidak valid'
            });
        }

        // Buat tabel leaderboard_history jika belum ada
        const createTableQuery = `
            CREATE TABLE IF NOT EXISTS leaderboard_history (
                id INT AUTO_INCREMENT PRIMARY KEY,
                period VARCHAR(100),
                rank INT,
                student_name VARCHAR(255),
                student_class VARCHAR(100),
                attendance_count INT,
                attendance_rate DECIMAL(5,2),
                generated_at DATETIME,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `;

        await db.execute(createTableQuery);

        // Hapus data lama untuk periode yang sama (optional)
        const deleteQuery = `DELETE FROM leaderboard_history WHERE period = ?`;
        await db.execute(deleteQuery, [period]);

        // Simpan setiap siswa ke database
        const insertQuery = `
            INSERT INTO leaderboard_history 
            (period, rank, student_name, student_class, attendance_count, attendance_rate, generated_at) 
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `;

        // Convert ISO string to MySQL datetime format
        const mysqlDateTime = generated_at ? 
            new Date(generated_at).toISOString().slice(0, 19).replace('T', ' ') : 
            new Date().toISOString().slice(0, 19).replace('T', ' ');

        console.log('MySQL DateTime:', mysqlDateTime);

        for (const student of top_students) {
            await db.execute(insertQuery, [
                period,
                student.rank,
                student.name,
                student.class,
                student.attendance_count,
                student.attendance_rate || 0,
                mysqlDateTime // Format: '2025-10-10 23:20:34'
            ]);
        }

        res.json({
            success: true,
            message: `Berhasil menyimpan ${top_students.length} siswa ke leaderboard`,
            data: {
                period: period,
                total_students: top_students.length,
                saved_at: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('Error saving leaderboard:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal menyimpan leaderboard: ' + error.message
        });
    }
});

// GET: Ambil riwayat leaderboard
app.get('/api/leaderboard/history', async (req, res) => {
    try {
        const query = `
            SELECT 
                period,
                GROUP_CONCAT(CONCAT(rank, '|', student_name, '|', student_class, '|', attendance_count) ORDER BY rank) as students_data,
                MAX(created_at) as created_at
            FROM leaderboard_history 
            GROUP BY period 
            ORDER BY created_at DESC
            LIMIT 10
        `;

        const [history] = await db.execute(query);

        // Format data
        const formattedHistory = history.map(item => {
            const students = item.students_data.split(',').map(student => {
                const [rank, name, className, count] = student.split('|');
                return {
                    rank: parseInt(rank),
                    name: name,
                    class: className,
                    attendance_count: parseInt(count)
                };
            });

            return {
                period: item.period,
                students: students,
                created_at: item.created_at
            };
        });

        res.json({
            success: true,
            data: formattedHistory
        });

    } catch (error) {
        console.error('Error fetching leaderboard history:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mengambil riwayat leaderboard'
        });
    }
});


//======= API ABSENSI ======//

app.post("/attendance", async (req, res) => {
    const { name, class: className } = req.body;
    
    if (!name || !className) {
        return res.status(400).json({ 
            success: false,
            message: "Nama dan kelas harus diisi" 
        });
    }

    try {
        // 1. Waktu Jakarta
        const now = new Date();
        const jakartaOffset = 7 * 60 * 60 * 1000;
        const jakartaTime = new Date(now.getTime() + jakartaOffset);
        const timeForDB = jakartaTime.toISOString().slice(0, 19).replace('T', ' ');

        // 2. Cek apakah sudah absen hari ini
        const [check] = await db.query(
            `SELECT * FROM attendance 
             WHERE name = ? 
             AND DATE(local_time) = CURDATE()`,
            [name]
        );

        if (check.length > 0) {
            return res.status(409).json({ 
                success: false,
                message: "Kamu sudah absen hari ini" 
            });
        }

        // 3. Simpan ke database
        const sql = "INSERT INTO attendance (name, class, time, local_time) VALUES (?, ?, ?, ?)";
        const [result] = await db.query(sql, [
            name, 
            className, 
            timeForDB, 
            timeForDB
        ]);

        console.log("Data tersimpan:", { 
            name, 
            class: className, 
            waktu_database: timeForDB,
            waktu_server: now.toString(),
            waktu_jakarta: jakartaTime.toString() 
        });
        
        res.json({ 
            success: true,
            message: "Absensi berhasil disimpan",
            data: { 
                name, 
                class: className, 
                time: timeForDB
            } 
        });
    } catch (err) {
        console.error("Error detail:", {
            message: err.message,
            sql: err.sql,
            code: err.code,
            stack: err.stack
        });
        
        res.status(500).json({ 
            success: false,
            message: "Terjadi kesalahan saat menyimpan data",
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});

const jwt = require('jsonwebtoken');
const SECRET_KEY = process.env.JWT_SECRET;

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        const [rows] = await db.execute(
            'SELECT * FROM admins WHERE username = ?', 
            [username]
        );
        
        if (rows.length === 0) {
            return res.status(401).json({ success: false, message: 'Username atau password salah' });
        }
        
        const admin = rows[0];
        const isMatch = await bcrypt.compare(password, admin.password);
        
        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'Username atau password salah' });
        }

        const token = jwt.sign(
            { id: admin.id, username: admin.username },
            SECRET_KEY,
            { expiresIn: '2h' }
        );

        res.json({ 
            success: true,
            message: 'Login berhasil',
            token, // << ini penting
            admin: {
                id: admin.id,
                username: admin.username,
                full_name: admin.full_name
            }
        });
        
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, message: 'Terjadi kesalahan server' });
    }
});

app.post('/api/register-admin', upload.single('photo'), async (req, res) => {
  try {
    const { full_name, username, password, email } = req.body;
    const photo = req.file;

    if (!full_name || !username || !password || !email) {
      return res.status(400).json({ success: false, message: 'Semua field wajib diisi' });
    }

    const [existing] = await db.execute('SELECT * FROM admins WHERE username = ?', [username]);
    if (existing.length > 0) {
      return res.status(409).json({ success: false, message: 'Username sudah digunakan' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const photo_url = photo ? `/uploads/admins/${photo.filename}` : null;

    await db.execute(
      'INSERT INTO admins (full_name, username, password, email, photo_url, is_active, created_at) VALUES (?, ?, ?, ?, ?, 1, NOW())',
      [full_name, username, hashedPassword, email, photo_url]
    );

    res.json({ success: true, message: 'Admin berhasil didaftarkan' });
  } catch (error) {
    console.error('Register admin error:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server' });
  }
});

app.get('/attendance', async (req, res) => {
    let { kelas, tanggal, jam } = req.query;

    console.log("Received Query Params:", { kelas, tanggal, jam });

    if (kelas && kelas.toUpperCase() !== "X GIM") {
        kelas = kelas.replace(/\s/g, "-"); // format kelas menggunakan "-"
    }

    try {
        let query = 'SELECT class, name, time FROM attendance';
        const conditions = [];
        const values = [];

        if (kelas && kelas.toLowerCase() !== "semua") {
            conditions.push('class = ?');
            values.push(kelas);
        }
        if (tanggal) {
            const formattedDate = new Date(tanggal).toISOString().slice(0, 10);
            conditions.push('DATE(CONVERT_TZ(time, "+00:00", "+07:00")) = ?');
            values.push(formattedDate);
        }
        if (jam) {
            conditions.push('HOUR(CONVERT_TZ(time, "+00:00", "+07:00")) = ?');
            values.push(jam);
        }

        if (conditions.length > 0) {
            query += ` WHERE ${conditions.join(' AND ')}`;
        }

        console.log('Running Query:', query, values);
        const [rows] = await db.query(query, values);

        console.log('Query Results:', rows);

        if (rows.length === 0) {
            console.log('No data found for the given criteria');
        }

        const rekap = rows.reduce((acc, row) => {
            const { class: studentClass, name } = row;
            if (!acc[studentClass]) acc[studentClass] = { count: 0, students: [] };
            acc[studentClass].count++;
            acc[studentClass].students.push(name);
            return acc;
        }, {});

        res.json(rekap);
    } catch (error) {
        console.error('Error loading rekap data:', error);
        res.status(500).json({ message: 'Gagal memuat data dari database.' });
    }
});

app.get("/check-attendance", async (req, res) => {
    const { name } = req.query;
    const today = new Date().toISOString().split("T")[0];

    console.log(`Cek absensi untuk: ${name}, tanggal: ${today}`);

    try {
        const [rows] = await db.query(
            "SELECT COUNT(*) as total FROM attendance WHERE name = ? AND DATE(time) = ?",
            [name, today]
        );

        console.log("Hasil Query:", rows);

        res.json({ attended: rows[0].total > 0 });
    } catch (error) {
        console.error("Database error:", error);
        res.status(500).json({ attended: false, error: error.message });
    }
});

app.get('/api/admin/profile', verifyAdminToken, async (req, res) => {
  try {
    const adminId = req.admin.id;
    const [rows] = await db.query(
      'SELECT full_name, photo_url FROM admins WHERE id = ?',
      [adminId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Admin tidak ditemukan' });
    }

    const { full_name, photo_url } = rows[0];
    res.json({
      success: true,
      data: {
        full_name,
        photo_url: photo_url || '/img/iconapp.png' // fallback jika belum ada foto
      }
    });
  } catch (err) {
    console.error('Gagal ambil profil admin:', err);
    res.status(500).json({ success: false, error: 'Gagal memuat data profil' });
  }
});

// GET: Ambil data leaderboard terbaru
app.get('/api/leaderboard/latest', async (req, res) => {
    try {
        // Cari periode terbaru
        const periodQuery = `
            SELECT period, MAX(created_at) as latest_date 
            FROM leaderboard_history 
            GROUP BY period 
            ORDER BY latest_date DESC 
            LIMIT 1
        `;

        const [periods] = await db.execute(periodQuery);
        
        if (periods.length === 0) {
            return res.json({
                success: true,
                data: [],
                period: 'Tidak ada data',
                last_updated: null
            });
        }

        const latestPeriod = periods[0].period;

        // Ambil data siswa untuk periode terbaru
        const studentsQuery = `
            SELECT * FROM leaderboard_history 
            WHERE period = ? 
            ORDER BY rank ASC 
            LIMIT 5
        `;

        const [students] = await db.execute(studentsQuery, [latestPeriod]);

        res.json({
            success: true,
            data: students,
            period: latestPeriod,
            last_updated: periods[0].latest_date
        });

    } catch (error) {
        console.error('Error fetching leaderboard:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mengambil data leaderboard'
        });
    }
});

// Ambil semua riwayat leaderboard
app.get('/api/leaderboard/history', async (req, res) => {
    try {
        const query = `
            SELECT period, MAX(created_at) as created_at 
            FROM leaderboard_history 
            GROUP BY period 
            ORDER BY created_at DESC
        `;

        const [history] = await db.execute(query);

        res.json({
            success: true,
            data: history
        });

    } catch (error) {
        console.error('Error fetching leaderboard history:', error);
        res.status(500).json({
            success: false,
            message: 'Gagal mengambil riwayat leaderboard'
        });
    }
});

// Endpoint untuk statistik dashboard
app.get('/api/dashboard/stats', verifyAdminToken, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayFormatted = yesterday.toISOString().split('T')[0];

    const [presentToday, absentToday, totalStudents] = await Promise.all([
      db.query(`SELECT COUNT(DISTINCT name) as total FROM attendance WHERE DATE(local_time) = ?`, [today]),
      db.query(`SELECT COUNT(*) as total FROM students WHERE class != 'Alumni' AND name NOT IN (SELECT DISTINCT name FROM attendance WHERE DATE(local_time) = ?)`, [today]),
      db.query(`SELECT COUNT(*) as total FROM students WHERE class != 'Alumni'`)
    ]);

    const [presentYesterday] = await db.query(`SELECT COUNT(DISTINCT name) as total FROM attendance WHERE DATE(local_time) = ?`, [yesterdayFormatted]);

    const getTotal = (result) => result?.[0]?.[0]?.total || 0;

    const presentCount = getTotal(presentToday);
    const absentCount = getTotal(absentToday);
    const yesterdayCount = getTotal(presentYesterday);
    const totalStudentsCount = getTotal(totalStudents);

    const percentageChange = yesterdayCount > 0 
      ? ((presentCount - yesterdayCount) / yesterdayCount * 100).toFixed(1)
      : 0;

    const attendancePercentage = totalStudentsCount > 0 
      ? (presentCount / totalStudentsCount * 100).toFixed(1)
      : 0;

    res.json({
      success: true,
      data: {
        presentToday: presentCount,
        absentToday: absentCount,
        totalStudents: totalStudentsCount,
        attendancePercentage,
        percentageChange: parseFloat(percentageChange)
      }
    });

  } catch (err) {
    console.error('Error fetching dashboard stats:', err);
    res.status(500).json({ success: false, error: 'Internal server error', details: err.message });
  }
});

// Endpoint untuk data grafik per kelas
app.get('/api/dashboard/class-stats', verifyAdminToken, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    const [classResults] = await db.query(
      `SELECT DISTINCT class FROM students WHERE class IS NOT NULL AND class != 'Alumni' ORDER BY class`
    );

    const classData = [];

    for (const row of classResults) {
      const cls = row.class;

      if (!cls) continue; // Skip jika null atau kosong

      const [[present]] = await db.query(
        `SELECT COUNT(DISTINCT a.name) as total
         FROM attendance a
         JOIN students s ON a.name = s.name AND a.class = s.class
         WHERE DATE(a.local_time) = ? AND s.class = ?`,
        [today, cls]
      );

      const [[totalInClass]] = await db.query(
        `SELECT COUNT(*) as total FROM students WHERE class = ?`,
        [cls]
      );

      classData.push({
        class_name: cls,
        total_present: present.total || 0,
        total_students: totalInClass.total || 0,
        percentage: totalInClass.total > 0
          ? ((present.total / totalInClass.total) * 100).toFixed(1)
          : '0.0'
      });
    }

    res.json({
      success: true,
      data: classData
    });

  } catch (err) {
    console.error('❌ Error fetching class stats:', err);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: err.message
    });
  }
});

// Endpoint untuk data perbandingan mingguan
app.get('/api/dashboard/weekly-comparison', verifyAdminToken, async (req, res) => {
  try {
    const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const weeklyData = [];

    const getTotal = (result) => result?.[0]?.[0]?.total || 0;

    for (let i = 6; i >= 0; i--) {
      const dayDate = new Date();
      dayDate.setDate(dayDate.getDate() - i);
      const formattedDate = dayDate.toISOString().split('T')[0];
      const dayName = days[dayDate.getDay()];

      const [present, absent] = await Promise.all([
        db.query(`SELECT COUNT(DISTINCT name) as total FROM attendance WHERE DATE(local_time) = ?`, [formattedDate]),
        db.query(`SELECT COUNT(*) as total FROM students WHERE class != 'Alumni' AND name NOT IN (
                    SELECT DISTINCT name FROM attendance WHERE DATE(local_time) = ?
                  )`, [formattedDate])
      ]);

      const presentCount = getTotal(present);
      const absentCount = getTotal(absent);

      weeklyData.push({
        day: dayName,
        date: formattedDate,
        present: presentCount,
        absent: absentCount,
        total: presentCount + absentCount
      });
    }

    res.json({
      success: true,
      data: weeklyData
    });

  } catch (err) {
    console.error('Error fetching weekly comparison:', err);
    res.status(500).json({ success: false, error: 'Internal server error', details: err.message });
  }
});

// Endpoint untuk aktivitas terkini
app.get('/api/dashboard/recent-activity', verifyAdminToken, async (req, res) => {
  try {
    const [recentAttendance] = await db.query(`
      SELECT 
        a.id, 
        a.name, 
        a.class, 
        a.local_time as time
      FROM attendance a
      ORDER BY a.local_time DESC
      LIMIT 5
    `);

    const activities = recentAttendance.map(item => ({
      name: item.name,
      class: item.class,
      status: 'Hadir', // kamu bisa ubah ini nanti jika ada data status
      time: item.time,
      type: 'attendance'
    }));

    res.json({
      success: true,
      data: activities
    });

  } catch (err) {
    console.error('Error fetching recent activity:', err);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error',
      details: err.message
    });
  }
});

app.get('/api/noatt-db', async (req, res) => {
    const { kelas, tanggal } = req.query;
    
    if (!tanggal) {
        return res.status(400).json({ error: 'Tanggal diperlukan' });
    }

    try {
        const formattedDate = new Date(tanggal).toISOString().slice(0, 10);
        
        // 1. Get all students in the specified class(es)
        let studentsQuery = `
            SELECT id, name, class 
            FROM students 
            WHERE class != 'Alumni'
            ${kelas && kelas.toLowerCase() !== "semua" ? 'AND class = ?' : ''}
            ORDER BY class, name
        `;
        
        const studentsParams = kelas && kelas.toLowerCase() !== "semua" ? [kelas] : [];
        const [students] = await db.query(studentsQuery, studentsParams);

        if (students.length === 0) {
            return res.json({ message: 'Tidak ada siswa di kelas ini', totalNoAttendance: 0 });
        }

        // 2. Get all attendance records for the date and class(es)
        let attendanceQuery = `
            SELECT a.name, a.class 
            FROM attendance a
            WHERE DATE(a.time) = ?
            ${kelas && kelas.toLowerCase() !== "semua" ? 'AND a.class = ?' : ''}
        `;
        
        const attendanceParams = kelas && kelas.toLowerCase() !== "semua" 
            ? [formattedDate, kelas] 
            : [formattedDate];
            
        const [attendance] = await db.query(attendanceQuery, attendanceParams);

        // 3. Create a map of present students (by name and class to avoid duplicates)
        const presentStudents = new Map();
        attendance.forEach(record => {
            const key = `${record.name.toLowerCase()}|${record.class}`;
            presentStudents.set(key, true);
        });

        // 4. Find students who didn't attend
        const absentStudents = students.filter(student => {
            const studentKey = `${student.name.toLowerCase()}|${student.class}`;
            return !presentStudents.has(studentKey);
        });

        // 5. Group by class
        const groupedByClass = absentStudents.reduce((acc, student) => {
            if (!acc[student.class]) acc[student.class] = [];
            acc[student.class].push(student.name);
            return acc;
        }, {});

        const total = absentStudents.length;

        if (total === 0) {
            res.json({ message: 'Semua siswa hadir', totalNoAttendance: 0 });
        } else {
            res.json({ 
                noAttendance: groupedByClass, 
                totalNoAttendance: total 
            });
        }
    } catch (error) {
        console.error('Error fetching data:', error);
        res.status(500).json({ 
            error: 'Error fetching data', 
            details: error.message 
        });
    }
});

app.get('/api/total-students', async (req, res) => {
    const { kelas } = req.query;

    try {
        let query;
        let params = [];

        if (kelas && kelas.toLowerCase() !== "semua") {
            query = `SELECT COUNT(*) as total FROM students WHERE class = ? AND class NOT IN ('Alumni', 'ALUMNI')`;
            params = [kelas];
        } else {
            query = `SELECT COUNT(*) as total FROM students WHERE class NOT IN ('Alumni', 'ALUMNI')`;
        }

        const [rows] = await db.query(query, params);

        res.json({ 
            success: true,
            total: rows[0].total 
        });
    } catch (error) {
        console.error('Error fetching total students:', error);
        res.status(500).json({ 
            success: false,
            error: 'Error fetching total students' 
        });
    }
});

// GET all students
app.get('/students', async (req, res) => {
  const { kelas } = req.query;

  let query = 'SELECT id, name, class, nis FROM students';
  let values = [];

  if (kelas && kelas !== 'Semua') {
    query += ' WHERE class = ?';
    values.push(kelas);
  }

  try {
    const [students] = await db.query(query, values);
    res.json({ success: true, data: students });
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengambil data siswa', detail: err.message });
  }
});

app.get('/students/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await db.query('SELECT id, name, class, nis FROM students WHERE id = ?', [id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Siswa tidak ditemukan' });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil data siswa', detail: err.message });
  }
});

// CREATE new student
app.post('/students', async (req, res) => {
  try {
    const { name, class: kelas, nis } = req.body;
    
    // Input validation
    if (!name || !kelas) {
      return res.status(400).json({ error: 'Nama dan kelas harus diisi' });
    }

    // Check for duplicate NIS
    if (nis) {
      const [existing] = await db.query('SELECT id FROM students WHERE nis = ?', [nis]);
      if (existing.length > 0) {
        return res.status(400).json({ error: 'NIS sudah terdaftar' });
      }
    }

    const [result] = await db.query(
      'INSERT INTO students (name, class, nis) VALUES (?, ?, ?)',
      [name, kelas, nis]
    );
    
    res.json({
      success: true,
      id: result.insertId,
      message: 'Siswa berhasil ditambahkan'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ 
      error: 'Gagal menambah siswa',
      detail: err.message 
    });
  }
});

// UPDATE student
app.put('/students/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, class: kelas, nis } = req.body;

    // Check if student exists
    const [existing] = await db.query('SELECT id FROM students WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Siswa tidak ditemukan' });
    }

    // Check for duplicate NIS (excluding current student)
    if (nis) {
      const [duplicate] = await db.query(
        'SELECT id FROM students WHERE nis = ? AND id != ?', 
        [nis, id]
      );
      if (duplicate.length > 0) {
        return res.status(400).json({ error: 'NIS sudah digunakan oleh siswa lain' });
      }
    }

    await db.query(
      'UPDATE students SET name = ?, class = ?, nis = ? WHERE id = ?',
      [name, kelas, nis, id]
    );
    
    res.json({ 
      success: true,
      message: 'Data siswa berhasil diperbarui'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ 
      error: 'Gagal mengupdate siswa',
      detail: err.message 
    });
  }
});

// DELETE student
app.delete('/students/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Check if student exists
    const [existing] = await db.query('SELECT id FROM students WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Siswa tidak ditemukan' });
    }

    await db.query('DELETE FROM students WHERE id = ?', [id]);
    
    res.json({ 
      success: true,
      message: 'Siswa berhasil dihapus'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ 
      error: 'Gagal menghapus siswa',
      detail: err.message 
    });
  }
});

app.get("/api/history", async (req, res) => {
    const { name } = req.query;

    if (!name) {
        return res.status(400).json({ error: "Nama pengguna diperlukan" });
    }

    try {
        const [rows] = await db.query(
            `SELECT name, class, 
            DATE_FORMAT(time, '%Y-%m-%d %H:%i:%s') AS time
            FROM attendance WHERE name = ? ORDER BY time DESC LIMIT 30`, 
            [name]
        );

        res.json(rows);
    } catch (error) {
        console.error("Error fetching history:", error);
        res.status(500).json({ error: "Gagal mengambil data" });
    }
});

app.get('/total-income', async (req, res) => {
    try {
        const [results] = await db.query('SELECT COUNT(*) AS total FROM attendance');
        const totalAbsensi = results[0].total;
        const income = totalAbsensi * 0.10;
        res.json({ totalIncome: income.toFixed(2) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get("/attendance/:kelas/:tanggal", async (req, res) => {
    try {
        const { kelas, tanggal } = req.params;
        
        console.log(`Mencari data untuk kelas: ${kelas}, tanggal: ${tanggal}`); // Log debugging

        // 1. Query jumlah hadir
        const [hadir] = await db.query(
            `SELECT COUNT(*) AS hadir FROM attendance 
             WHERE class = ? 
             AND DATE(CONVERT_TZ(time, '+00:00', '+07:00')) = ?`,
            [kelas, tanggal]
        );

        console.log(`Jumlah hadir: ${hadir[0].hadir}`); // Log debugging

        // 2. Query total siswa
        const [totalSiswa] = await db.query(
            `SELECT COUNT(*) AS total FROM students 
             WHERE class = ?`,
            [kelas]
        );

        console.log(`Total siswa: ${totalSiswa[0].total}`); // Log debugging

        const tidakHadir = totalSiswa[0].total - hadir[0].hadir;

        res.json({
            hadir: hadir[0].hadir,
            tidak_hadir: tidakHadir,
            timezone: 'UTC+7'
        });

    } catch (err) {
        console.error("Error:", {
            message: err.message,
            stack: err.stack,
            query: err.sql
        });
        res.status(500).json({ 
            error: "Kesalahan server",
            details: process.env.NODE_ENV === 'development' ? err.message : null
        });
    }
});

app.get('/absensi/:kelas', async (req, res) => {
    const kelas = req.params.kelas;
    const today = new Date().toISOString().split('T')[0];
    
    console.log(`Request absensi untuk kelas: ${kelas}, tanggal: ${today}`); // Log debugging

    try {
        const query = `
            SELECT 
                s.name, 
                IF(a.id IS NOT NULL, 'hadir', 'tidak hadir') AS status
            FROM students s
            LEFT JOIN attendance a ON 
                s.name = a.name AND 
                s.class = a.class AND 
                DATE(CONVERT_TZ(a.time, '+00:00', '+07:00')) = ?
            WHERE s.class = ?
            ORDER BY s.name`;
        
        console.log('Executing query:', query); // Log query
        const [results] = await db.query(query, [today, kelas]);
        
        console.log('Query results:', results); // Log hasil query
        
        res.json(results);
        
    } catch (err) {
        console.error('Database error:', {
            message: err.message,
            sql: err.sql,
            stack: err.stack
        });
        
        res.status(500).json({ 
            success: false,
            error: "Database error",
            details: process.env.NODE_ENV === 'development' ? err.message : null
        });
    }
});

app.get("/debug/attendance/:name", async (req, res) => {
    try {
        const { name } = req.params;
        
        const [records] = await db.query(
            `SELECT 
                name,
                class,
                time AS waktu_utc,
                CONVERT_TZ(time, '+00:00', '+07:00') AS waktu_jakarta,
                DATE_FORMAT(CONVERT_TZ(time, '+00:00', '+07:00'), '%Y-%m-%d %H:%i:%s') AS waktu_format
             FROM attendance 
             WHERE name = ? 
             ORDER BY time DESC 
             LIMIT 5`,
            [name]
        );
        
        res.json({
            success: true,
            data: records,
            serverTime: new Date(),
            jakartaTime: new Date(new Date().getTime() + 7 * 60 * 60 * 1000)
        });
    } catch (err) {
        console.error("Debug error:", err);
        res.status(500).json({ 
            success: false, 
            error: err.message 
        });
    }
});

app.get("/debug/attendance/latest", async (req, res) => {
    try {
        const [latestRecord] = await db.query(`
            SELECT 
                id,
                name,
                class,
                time AS database_time,
                local_time,
                DATE_FORMAT(time, '%Y-%m-%d %H:%i:%s') AS formatted_time,
                DATE_FORMAT(local_time, '%Y-%m-%d %H:%i:%s') AS formatted_local_time
            FROM attendance
            ORDER BY time DESC
            LIMIT 1
        `);
        
        res.json({
            success: true,
            data: latestRecord,
            server_info: {
                server_time: new Date().toString(),
                jakarta_time: new Date(new Date().getTime() + 7 * 60 * 60 * 1000).toString(),
                timezone_offset: new Date().getTimezoneOffset()
            }
        });
    } catch (err) {
        console.error("Debug error:", err);
        res.status(500).json({ 
            success: false, 
            error: err.message 
        });
    }
});

app.get("/debug/attendance-today", async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const [data] = await db.query(
            `SELECT 
                a.class,
                COUNT(a.id) AS hadir,
                (SELECT COUNT(*) FROM students s WHERE s.class = a.class) AS total,
                (SELECT COUNT(*) FROM students s WHERE s.class = a.class) - COUNT(a.id) AS tidak_hadir
             FROM attendance a
             WHERE DATE(CONVERT_TZ(a.time, '+00:00', '+07:00')) = ?
             GROUP BY a.class`,
            [today]
        );
        
        res.json({
            date: today,
            data: data,
            all_classes: await getClassList() // Fungsi tambahan untuk mendapatkan daftar kelas
        });
    } catch (err) {
        console.error("Debug error:", err);
        res.status(500).json({ error: err.message });
    }
});

async function getClassList() {
    const [classes] = await db.query("SELECT DISTINCT class FROM students ORDER BY class");
    return classes.map(c => c.class);
}

app.post('/submit-rating', async (req, res) => {
  try {
    const { name, rating, comment } = req.body;
    
    // Simpan ke database
    const result = await db.query(
      'INSERT INTO ratings (name, rating, comment) VALUES (?, ?, ?)',
      [name, rating, comment]
    );
    
    res.json({ success: true, message: 'Rating berhasil disimpan' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
