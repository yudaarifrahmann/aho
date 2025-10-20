const { spawn } = require("child_process");
const path = require("path");

process.on("message", (studentData) => {
  const python = spawn("python", [path.join(__dirname, "buat_kartu.py"), JSON.stringify(studentData)]);

  python.on("close", (code) => {
    if (code === 0) {
      process.send({ success: true, file_url: `https://absen.ahoservice.my.id/cards/${studentData.nisn}.png` });
    } else {
      process.send({ success: false, error: "Gagal membuat kartu" });
    }
    process.exit();
  });
});
