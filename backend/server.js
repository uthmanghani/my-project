require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { connectDB } = require('./config/db');

// Import middleware
const { authenticateToken } = require('./middleware/auth');
const errorHandler = require('./middleware/errorHandler');
const { generalLimiter, authLimiter } = require('./middleware/rateLimiter');

// Import routes
const authRoutes = require('./routes/authRoutes');
const companyRoutes = require('./routes/companyRoutes');
const accountRoutes = require('./routes/accountRoutes');
const customerRoutes = require('./routes/customerRoutes');
const vendorRoutes = require('./routes/vendorRoutes');
const productRoutes = require('./routes/productRoutes');
const invoiceRoutes = require('./routes/invoiceRoutes');
const billRoutes = require('./routes/billRoutes');
const journalRoutes = require('./routes/journalRoutes');
const employeeRoutes = require('./routes/employeeRoutes');
const assetRoutes = require('./routes/assetRoutes');
const budgetRoutes = require('./routes/budgetRoutes');
const reportRoutes = require('./routes/reportRoutes');
const auditRoutes = require('./routes/auditRoutes');
const bankRoutes = require('./routes/bankRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const openingBalanceRoutes = require('./routes/openingBalanceRoutes');
const exportImportRoutes = require('./routes/exportImportRoutes');
const payrollRoutes = require('./routes/payrollRoutes');

const app = express();

// ==================== CONNECT TO DATABASE ====================
connectDB();

// ==================== MIDDLEWARE ====================
// Enable CORS for frontend development
app.use(cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5500', 'file://'],
  credentials: true
}));

// Parse JSON bodies
app.use(express.json());

// Apply rate limiting to all API routes
app.use('/api/', generalLimiter);

// Stricter rate limiting for auth endpoints
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// ==================== ROUTES ====================
// Public routes
app.use('/api/auth', authRoutes);

// Protected routes (require authentication)
app.use('/api/company', authenticateToken, companyRoutes);
app.use('/api/accounts', authenticateToken, accountRoutes);
app.use('/api/customers', authenticateToken, customerRoutes);
app.use('/api/vendors', authenticateToken, vendorRoutes);
app.use('/api/products', authenticateToken, productRoutes);
app.use('/api/invoices', authenticateToken, invoiceRoutes);
app.use('/api/bills', authenticateToken, billRoutes);
app.use('/api/journals', authenticateToken, journalRoutes);
app.use('/api/employees', authenticateToken, employeeRoutes);
app.use('/api/assets', authenticateToken, assetRoutes);
app.use('/api/budgets', authenticateToken, budgetRoutes);
app.use('/api/reports', authenticateToken, reportRoutes);
app.use('/api/audit', authenticateToken, auditRoutes);
app.use('/api/bankaccounts', authenticateToken, bankRoutes);
app.use('/api/banktransactions', authenticateToken, bankRoutes);
app.use('/api/customerpayments', authenticateToken, paymentRoutes);
app.use('/api/vendorpayments', authenticateToken, paymentRoutes);
app.use('/api/openingbalances', authenticateToken, openingBalanceRoutes);
app.use('/api/export', authenticateToken, exportImportRoutes);
app.use('/api/import', authenticateToken, exportImportRoutes);
app.use('/api/payroll', authenticateToken, payrollRoutes);

// ==================== HEALTH CHECK ====================
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// ==================== 404 HANDLER ====================
app.use('*', (req, res) => {
  res.status(404).json({ error: `Route ${req.originalUrl} not found` });
});

// ==================== GLOBAL ERROR HANDLER ====================
app.use(errorHandler);

// ==================== START SERVER ====================
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 API base URL: http://localhost:${PORT}/api`);
  console.log(`✅ Health check: http://localhost:${PORT}/health`);
});

// ==================== GRACEFUL SHUTDOWN ====================
const { closeDB } = require('./config/db');

process.on('SIGINT', async () => {
  console.log('🔴 Shutting down gracefully...');
  server.close(async () => {
    await closeDB();
    console.log('🟢 Server stopped');
    process.exit(0);
  });
});

process.on('SIGTERM', async () => {
  console.log('🔴 SIGTERM received. Shutting down...');
  server.close(async () => {
    await closeDB();
    console.log('🟢 Server stopped');
    process.exit(0);
  });
});