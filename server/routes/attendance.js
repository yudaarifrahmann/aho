const express = require("express");
const router = express.Router();
const db = require("../db");

router.post("/", (req, res) => {
    const { name, class: userClass, time } = req.body;

    if (!name || !userClass || !time) {
        return res.status(400).json({ success: false, message: "Data tidak lengkap!" });
    }

    const sql = "INSERT INTO attendance (name, class, time) VALUES (?, ?, ?)";
    db.query(sql, [name, userClass, time], (err, result) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ success: false, message: "Gagal menyimpan absensi!" });
        }
        res.json({ success: true, message: "Absensi berhasil!" });
    });
});

module.exports = router;
