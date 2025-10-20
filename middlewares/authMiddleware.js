const jwt = require('jsonwebtoken');
const SECRET_KEY = process.env.JWT_SECRET;

const getVerifyAdminToken = (db) => {
  return async (req, res, next) => {
    try {
      const token = req.headers.authorization?.split(' ')[1];
      
      if (!token) {
        return res.status(401).json({ 
          success: false,
          error: 'Token tidak ditemukan' 
        });
      }

      const decoded = jwt.verify(token, SECRET_KEY);

      const [rows] = await db.execute(
        'SELECT id, username, full_name FROM admins WHERE id = ? AND is_active = 1',
        [decoded.id]
      );

      if (rows.length === 0) {
        return res.status(401).json({ 
          success: false,
          error: 'Akun tidak ditemukan atau tidak aktif' 
        });
      }

      req.admin = rows[0];
      next();

    } catch (err) {
      console.error('Token verification error:', err);

      let errorMessage = 'Autentikasi gagal';
      if (err.name === 'JsonWebTokenError') {
        errorMessage = 'Token tidak valid';
      } else if (err.name === 'TokenExpiredError') {
        errorMessage = 'Token telah kadaluarsa';
      }

      res.status(401).json({ 
        success: false,
        error: errorMessage,
        details: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    }
  };
};

module.exports = { getVerifyAdminToken };
