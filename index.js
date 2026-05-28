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
mongoose.connect(process.env.MONGO_URI, {
  maxPoolSize: 10,
})
  .then(() => console.log("✅ SR GOLD Wallet Database Connected!"))
  .catch((err) => console.log("❌ DB Error:", err));

// =======================
// 📜 SCHEMAS & MODELS
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

// FIREBASE INITIALIZATION
const privateKey = process.env.FIREBASE_PRIVATE_KEY 
  ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n") 
  : undefined;

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: privateKey,
  }),
});

// =======================
// 🔐 AUTH MIDDLEWARE
// =======================
const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ success: false, message: "Unauthorized: Missing Token" });
    }

    const token = authHeader.split("Bearer ")[1];
    const decoded = await admin.auth().verifyIdToken(token);
    
    req.user = decoded; // Contains uid, email, etc.
    next();
  } catch (err) {
    console.error("AUTH ERROR:", err.message);
    res.status(401).json({ success: false, message: "Unauthorized", error: err.message });
  }
};

// =======================
// 👑 ADMIN MIDDLEWARE
// =======================
const adminMiddleware = async (req, res, next) => {
  try {
    const email = req.user.email?.toLowerCase().trim();
    const ADMIN_EMAILS = ["sumit311shk@gmail.com"];

    if (!email || !ADMIN_EMAILS.includes(email)) {
      return res.status(403).json({ success: false, message: "Access Denied. Not an Admin." });
    }
    next();
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

// =======================
// 👤 USER SCHEMA
// =======================
const UserSchema = new mongoose.Schema({
  firebaseUid: { type: String, required: true, unique: true },
  email: { type: String },
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
      { $match: { type: "withdrawal", status: "completed" } }, // Added check for completed only
      { $group: { _id: null, totalRevenue: { $sum: { $toDouble: "$rate" } } } }
    ]);

    res.json({
      totalVolume: investmentAgg[0]?.total || 0,
      activeUsers: totalUsers || 0,
      orders: totalOrders || 0,
      revenue: revenueAgg[0]?.totalRevenue || 0,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

// =====================================================
// 🔔 NOTIFICATIONS (SECURED)
// =====================================================
app.post("/api/notifications/send", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { uid, title, message, type } = req.body;
    if (!uid || !title || !message) {
      return res.status(400).json({ success: false, error: "All fields are required" });
    }

    const notification = await Notification.create({
      uid, title, message, type: type || "info",
    });

    res.json({ success: true, notification });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to send notification" });
  }
});

app.get("/api/notifications/:uid", authMiddleware, async (req, res) => {
  try {
    if (req.user.uid !== req.params.uid) {
      return res.status(403).json({ success: false, message: "Forbidden Access" });
    }
    const notifications = await Notification.find({ uid: req.params.uid }).sort({ createdAt: -1 });
    res.json(notifications);
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to fetch notifications" });
  }
});

app.get("/api/notifications/unread/:uid", authMiddleware, async (req, res) => {
  try {
    if (req.user.uid !== req.params.uid) return res.status(403).json({ success: false });
    const count = await Notification.countDocuments({ uid: req.params.uid, read: false });
    res.json({ success: true, count });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

app.put("/api/notifications/read/:uid", authMiddleware, async (req, res) => {
  try {
    if (req.user.uid !== req.params.uid) return res.status(403).json({ success: false });
    await Notification.updateMany({ uid: req.params.uid, read: false }, { $set: { read: true } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// =====================================================
// 🎁 ADMIN GIFT BALANCE
// =====================================================
app.post("/api/admin/gift-balance", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { uid, metal, grams } = req.body;
    if (!uid || !metal || !grams) {
      return res.status(400).json({ success: false, error: "All fields are required" });
    }

    const field = metal === "gold" ? "goldBalance" : "silverBalance";
    const updatedUser = await User.findOneAndUpdate(
      { firebaseUid: uid },
      { $inc: { [field]: Number(grams) } },
      { new: true }
    );

    if (!updatedUser) return res.status(404).json({ success: false, error: "User not found" });

    await Transaction.create({
      userId: uid,
      userName: updatedUser.displayName,
      userEmail: updatedUser.email,
      type: "investment",
      metal,
      weight: Number(grams),
      amount: 0,
      rate: 0,
      status: "completed",
    });

    res.json({ success: true, user: updatedUser });
  } catch (err) {
    res.status(500).json({ success: false, error: "Failed to gift balance" });
  }
});

// =====================================================
// 🔐 AUTH SYNC
// =====================================================
app.post("/api/auth/sync-user", authMiddleware, async (req, res) => {
  try {
    const { uid, email, displayName, phone } = req.body;
    if (req.user.uid !== uid) {
      return res.status(403).json({ error: "Unauthorized Identity Sync" });
    }

    const updatedUser = await User.findOneAndUpdate(
      { firebaseUid: uid },
      { $set: { email: email || "", displayName: displayName || "User", phone: phone || "" } },
      { interstate: true, upsert: true, new: true }
    );

    res.json(updatedUser);
  } catch (err) {
    res.status(500).json({ error: "Auth Sync Failed" });
  }
});

// =====================================================
// 👤 USER BALANCE (SECURED)
// =====================================================
app.get("/api/user/balance/:uid", authMiddleware, async (req, res) => {
  try {
    if (req.user.uid !== req.params.uid) {
      return res.status(403).json({ error: "Forbidden Access" });
    }

    const user = await User.findOne({ firebaseUid: req.params.uid }).lean();
    if (!user) return res.status(404).json({ error: "User not found" });

    let settings = await Setting.findOne().lean();
    if (!settings) settings = await Setting.create({});

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
    res.status(500).json({ error: "Error fetching balance" });
  }
});

// =====================================================
// 💸 INVEST REQUEST (SECURED)
// =====================================================
app.post("/api/user/invest", authMiddleware, async (req, res) => {
  try {
    const { userId, amount, metal, email, displayName, utr } = req.body;
    if (req.user.uid !== userId) {
      return res.status(403).json({ error: "Forbidden action" });
    }

    if (!userId || !amount || !metal) {
      return res.status(400).json({ error: "Missing fields" });
    }

    let settings = await Setting.findOne();
    if (!settings) settings = await Setting.create({});

    const rate = metal === "gold" ? settings.goldRate : settings.silverRate;
    const weight = Number(amount) / Number(rate);

    const newTransaction = await Transaction.create({
      userId,
      userName: displayName || "User",
      userEmail: email || "No Email",
      amount: Number(amount),
      metal,
      weight,
      rate,
      utr: utr || "",
      type: "investment",
      status: "pending",
    });

    res.json({ success: true, transaction: newTransaction });
  } catch (err) {
    res.status(500).json({ error: "Investment failed" });
  }
});

// =====================================================
// ✅ ADMIN APPROVE INVESTMENT
// =====================================================
app.post("/api/admin/approve-investment", authMiddleware, adminMiddleware, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { transactionId } = req.body;
    const tx = await Transaction.findById(transactionId).session(session);

    if (!tx || tx.status !== "pending") {
      throw new Error("Transaction unavailable or already processed");
    }

    const field = tx.metal === "gold" ? "goldBalance" : "silverBalance";

    const updatedUser = await User.findOneAndUpdate(
      { firebaseUid: tx.userId },
      { $inc: { [field]: Number(tx.weight), balance: Number(tx.amount) } },
      { session, new: true }
    );

    if (!updatedUser) throw new Error("User associated with tx not found");

    tx.status = "completed";
    tx.approvedAt = new Date();
    await tx.save({ session });

    await session.commitTransaction();
    res.json({ success: true, message: "Approved successfully", updatedBalance: updatedUser });
  } catch (err) {
    await session.abortTransaction();
    res.status(500).json({ error: err.message });
  } finally {
    session.endSession();
  }
});

// =====================================================
// ❌ ADMIN REJECT INVESTMENT
// =====================================================
app.post("/api/admin/reject-investment", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { transactionId } = req.body;
    const tx = await Transaction.findById(transactionId);

    if (!tx || tx.status !== "pending") {
      return res.status(400).json({ error: "Transaction not found or processed" });
    }

    tx.status = "failed";
    tx.rejectedAt = new Date();
    await tx.save();

    res.json({ success: true, message: "Investment rejected successfully" });
  } catch (err) {
    res.status(500).json({ error: "Reject failed" });
  }
});

// =====================================================
// 🏧 WITHDRAW
// =====================================================
app.post("/api/user/withdraw", authMiddleware, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { uid, assetType, grams, payoutAmount, charges } = req.body;
    if (req.user.uid !== uid) return res.status(403).json({ error: "Unauthorized Operation" });

    const field = assetType === "gold" ? "goldBalance" : "silverBalance";

    const user = await User.findOneAndUpdate(
      { firebaseUid: uid, [field]: { $gte: Number(grams) } },
      { $inc: { [field]: -Number(grams) } },
      { session, new: true }
    );

    if (!user) {
      await session.abortTransaction();
      return res.status(400).json({ error: "Insufficient balance" });
    }

    await Transaction.create([{
      userId: uid,
      userName: user.displayName,
      userEmail: user.email,
      type: "withdrawal",
      metal: assetType,
      weight: Number(grams),
      amount: Number(payoutAmount),
      rate: Number(charges || 0),
      status: "pending",
    }], { session });

    await session.commitTransaction();
    res.json({ success: true });
  } catch (err) {
    if (session.inTransaction()) await session.abortTransaction();
    res.status(500).json({ error: err.message });
  } finally {
    session.endSession();
  }
});

// =====================================================
// 👨‍💼 ADMIN USERS (OPTIMIZED JOIN VIA AGGREGATION)
// =====================================================
app.get("/api/admin/users", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const finalUsers = await User.aggregate([
      { $sort: { createdAt: -1 } },
      {
        $lookup: {
          from: "transactions",
          localField: "firebaseUid",
          foreignField: "userId",
          as: "txDetails"
        }
      },
      {
        $project: {
          displayName: 1,
          email: 1,
          phone: 1,
          createdAt: 1,
          balance: 1,
          firebaseUid: 1,
          transactionCount: { $size: "$txDetails" },
          totalInvested: {
            $sum: {
              $map: {
                input: {
                  $filter: {
                    input: "$txDetails",
                    as: "t",
                    cond: { 
                      $and: [
                        { $eq: ["$$t.type", "investment"] },
                        { $eq: ["$$t.status", "completed"] }
                      ]
                    }
                  }
                },
                as: "filteredTx",
                in: { $convert: { input: "$$filteredTx.amount", to: "double", onError: 0, onNull: 0 } }
              }
            }
          }
        }
      }
    ]);

    res.json(finalUsers);
  } catch (err) {
    res.status(500).json({ error: "Users fetch failed" });
  }
});

// =====================================================
// ⚙️ SETTINGS ROUTES
// =====================================================
app.get("/api/admin/settings", async (req, res) => {
  try {
    let settings = await Setting.findOne().lean();
    if (!settings) settings = await Setting.create({});
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: "Settings fetch failed" });
  }
});

app.post("/api/admin/update-settings", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const updatedSettings = await Setting.findOneAndUpdate(
      {},
      { ...req.body, lastUpdated: Date.now() },
      { upsert: true, new: true }
    );
    res.json({ success: true, settings: updatedSettings });
  } catch (err) {
    res.status(500).json({ error: "Failed to update settings" });
  }
});

// =====================================================
// 📜 TRANSACTIONS ROUTES
// =====================================================
app.get("/api/user/transactions/:uid", authMiddleware, async (req, res) => {
  try {
    const { uid } = req.params;
    if (req.user.uid !== uid) return res.status(403).json({ error: "Forbidden Access" });

    const user = await User.findOne({ firebaseUid: uid }).lean();
    if (!user) return res.status(404).json({ error: "User not found" });

    const transactions = await Transaction.find({ userId: uid }).sort({ date: -1 }).lean();

    res.json({
      email: user.email || "No Email",
      displayName: user.displayName || "Investor",
      goldBalance: user.goldBalance || 0,
      silverBalance: user.silverBalance || 0,
      transactions: transactions || [],
    });
  } catch (err) {
    res.status(500).json({ error: "Fetch failed" });
  }
});

app.get("/api/admin/all-transactions", authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const transactions = await Transaction.find().sort({ date: -1 }).lean();
    res.json(transactions);
  } catch (err) {
    res.status(500).json({ error: "Fetch failed" });
  }
});

// =======================
// 🌍 ROOT & START
// =======================
app.get("/", (req, res) => {
  res.send("🚀 SR Gold Wallet Backend Running Successfully");
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));