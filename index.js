import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import admin from "firebase-admin";
import compression from "compression";

// =======================
// ⚙️ CONFIG
// =======================
dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());
app.use(compression());

// =======================
// 🔗 MONGODB CONNECTION
// =======================
mongoose
  .connect(process.env.MONGO_URI, {
    maxPoolSize: 10,
  })
  .then(() => console.log("✅ SR GOLD Wallet Database Connected!"))
  .catch((err) => console.error("❌ DB Error:", err.message));

// =======================
// 🔥 FIREBASE INIT
// =======================
const privateKey = process.env.FIREBASE_PRIVATE_KEY
  ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
  : undefined;

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey,
  }),
});

// =======================
// 🔐 AUTH MIDDLEWARE
// =======================
const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: Missing Token",
      });
    }

    const token = authHeader.split("Bearer ")[1];
    if (!token) {
      return res.status(401).json({
        success: false,
        message: "No Token Provided",
      });
    }

    const decoded = await admin.auth().verifyIdToken(token);
    req.user = decoded;
    next();
  } catch (err) {
    console.error("AUTH ERROR:", err.message);
    res.status(401).json({
      success: false,
      message: "Unauthorized",
      error: err.message,
    });
  }
};

// =======================
// 👑 ADMIN MIDDLEWARE
// =======================
const adminMiddleware = async (req, res, next) => {
  try {
    const ADMIN_EMAILS = ["sumit311shk@gmail.com"];
    const email = (
      req.user?.email ||
      req.user?.firebase?.identities?.email?.[0] ||
      ""
    )
      .toLowerCase()
      .trim();

    if (!email) {
      return res.status(403).json({
        success: false,
        message: "No Email Found",
      });
    }

    const isAdmin = ADMIN_EMAILS.includes(email);

    if (!isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Access Denied. Not an Admin.",
      });
    }

    next();
  } catch (err) {
    console.error("ADMIN ERROR:", err.message);
    res.status(500).json({
      success: false,
      message: "Admin Middleware Failed",
    });
  }
};

// =======================
// 👤 USER SCHEMA
// =======================
const UserSchema = new mongoose.Schema({
  firebaseUid: { type: String, required: true, unique: true },
  email: String,
  displayName: { type: String, default: "User" },
  phone: String,
  balance: { type: Number, default: 0 },
  goldBalance: { type: Number, default: 0 },
  silverBalance: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});

UserSchema.index({ firebaseUid: 1 });
UserSchema.index({ createdAt: -1 });

const User = mongoose.model("User", UserSchema);

// =======================
// ⚙️ SETTINGS SCHEMA
// =======================
const SettingSchema = new mongoose.Schema({
  goldRate: { type: Number, default: 6000 },
  silverRate: { type: Number, default: 75 },
  goldWithdrawFee: { type: Number, default: 2.5 },
  silverWithdrawFee: { type: Number, default: 2.5 },
  fixedGoldCharge: { type: Number, default: 0 },
  fixedSilverCharge: { type: Number, default: 0 },
  lastUpdated: { type: Date, default: Date.now },
});

const Setting = mongoose.model("Setting", SettingSchema);

// =======================
// 📊 TRANSACTION SCHEMA
// =======================
const TransactionSchema = new mongoose.Schema({
  userId: String,
  userName: String,
  userEmail: String,
  amount: Number,
  metal: String,
  weight: Number,
  rate: Number,
  utr: { type: String, default: "" },
  type: { type: String, enum: ["investment", "withdrawal"], default: "investment" },
  status: { type: String, enum: ["pending", "completed", "failed"], default: "pending" },
  approvedAt: Date,
  rejectedAt: Date,
  date: { type: Date, default: Date.now },
});

TransactionSchema.index({ userId: 1 });
TransactionSchema.index({ status: 1 });
TransactionSchema.index({ type: 1 });

const Transaction = mongoose.model("Transaction", TransactionSchema);

// =======================
// 🔔 NOTIFICATION SCHEMA
// =======================
const notificationSchema = new mongoose.Schema(
  {
    uid: { type: String, required: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    type: { type: String, default: "info" },
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

notificationSchema.index({ uid: 1, read: 1 });

const Notification = mongoose.model("Notification", notificationSchema);

// =====================================================
// 📊 ADMIN STATS
// =====================================================
app.get("/api/admin/stats", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalOrders = await Transaction.countDocuments();

    const investmentAgg = await User.aggregate([
      { $group: { _id: null, total: { $sum: "$balance" } } },
    ]);

    const revenueAgg = await Transaction.aggregate([
      { $match: { type: "withdrawal", status: "completed" } },
      { $group: { _id: null, totalRevenue: { $sum: "$rate" } } },
    ]);

    res.json({
      totalVolume: investmentAgg[0]?.total || 0,
      activeUsers: totalUsers || 0,
      orders: totalOrders || 0,
      revenue: revenueAgg[0]?.totalRevenue || 0,
    });
  } catch (err) {
    console.error("STATS ERROR:", err.message);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

// =====================================================
// 👤 USER BALANCE
// =====================================================
app.get("/api/user/balance/:uid", authMiddleware, async (req, res) => {
  try {
    if (req.user.uid !== req.params.uid) {
      return res.status(403).json({ error: "Forbidden Access" });
    }

    const user = await User.findOne({ firebaseUid: req.params.uid }).lean();
    if (!user) return res.status(404).json({ error: "User not found" });

    // Fallback optimization agar database empty hone par crash na ho
    const settings = (await Setting.findOne().lean()) || { goldRate: 6000, silverRate: 75 };

    res.json({
      cash: user.balance,
      gold: user.goldBalance,
      silver: user.silverBalance,
      goldRate: settings.goldRate,
      silverRate: settings.silverRate,
      displayName: user.displayName,
      email: user.email,
    });
  } catch (err) {
    console.error("BALANCE ERROR:", err.message);
    res.status(500).json({ error: "Error fetching balance" });
  }
});

// =====================================================
// 🔔 GET USER NOTIFICATIONS
// =====================================================
app.get("/api/notifications/:uid", authMiddleware, async (req, res) => {
  try {
    if (req.user.uid !== req.params.uid) {
      return res.status(403).json({ success: false, message: "Forbidden Access" });
    }

    const notifications = await Notification.find({ uid: req.params.uid })
      .sort({ createdAt: -1 })
      .lean();

    res.json(notifications);
  } catch (err) {
    console.error("NOTIFICATION FETCH ERROR:", err.message);
    res.status(500).json({ success: false, error: "Failed to fetch notifications" });
  }
});

// =====================================================
// 🔴 UNREAD COUNT
// =====================================================
app.get("/api/notifications/unread/:uid", authMiddleware, async (req, res) => {
  try {
    if (req.user.uid !== req.params.uid) {
      return res.status(403).json({ success: false });
    }

    const count = await Notification.countDocuments({
      uid: req.params.uid,
      read: false,
    });

    res.json({ success: true, count });
  } catch (err) {
    console.error("UNREAD COUNT ERROR:", err.message);
    res.status(500).json({ success: false });
  }
});

// =====================================================
// 🌍 ROOT ROUTE
// =====================================================
app.get("/", (req, res) => {
  res.send("🚀 SR Gold Wallet Backend Running Successfully");
});

// =======================
// 🚀 START SERVER
// =======================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));