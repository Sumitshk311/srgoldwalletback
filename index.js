import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import admin from "firebase-admin";
import fs from "fs";
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
  .then(() =>
    console.log(
      "✅ SR GOLD Wallet Database Connected!"
    )
  )
  .catch((err) =>
    console.log("❌ DB Error:", err)
  );

const notificationSchema = new mongoose.Schema(
  {
    uid: {
      type: String,
      required: true,
    },

    title: {
      type: String,
      required: true,
    },

    message: {
      type: String,
      required: true,
    },

    type: {
      type: String,
      default: "info",
    },

    read: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

const Notification = mongoose.model(
  "Notification",
  notificationSchema
);

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  }),
});


// =======================
// =======================
// 🔐 AUTH MIDDLEWARE
// =======================

const authMiddleware = async (
  req,
  res,
  next
) => {
  try {

    const authHeader =
      req.headers.authorization;

    console.log(
      "AUTH HEADER:",
      authHeader
    );

    if (!authHeader) {
      return res.status(401).json({
        success: false,
        message: "No Authorization Header",
      });
    }

    const token =
  authHeader?.startsWith("Bearer ")
    ? authHeader.split("Bearer ")[1]
    : null;

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "No Token",
      });
    }

    const decoded =
      await admin
        .auth()
        .verifyIdToken(token);

    console.log(
      "DECODED TOKEN:",
      decoded
    );

    console.log(
      "DECODED EMAIL:",
      decoded.email
    );

    req.user = decoded;

    next();

  } catch (err) {

    console.log(
      "AUTH ERROR:",
      err
    );

    res.status(401).json({
      success: false,
      message: "Unauthorized",
      error: err.message,
    });
  }
};


// =======================
// =======================
// =======================
// 👑 ADMIN MIDDLEWARE
// =======================
const adminMiddleware = async (req, res, next) => {
  try {

    const ADMIN_EMAILS = [
      "sumit311shk@gmail.com",
    ];

    // ✅ MULTIPLE SOURCE EMAIL EXTRACT
    let email =
      req.user.email ||
      req.user.firebase?.identities?.email?.[0] ||
      req.user?.email_verified && req.user?.email ||
      "";

    email = email.toLowerCase().trim();

    console.log("🔥 BACKEND EMAIL:", email);
    console.log("🔥 FULL TOKEN:", req.user);

    if (!email) {
      return res.status(403).json({
        success: false,
        message: "No Email Found in Token",
      });
    }

    const isAdmin = ADMIN_EMAILS.includes(email);

    console.log("🔥 IS ADMIN:", isAdmin);

    if (!isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Access Denied",
        backendEmail: email,
      });
    }

    next();

  } catch (err) {
    console.log("ADMIN ERROR:", err);

    res.status(500).json({
      success: false,
      message: "Admin Check Failed",
    });
  }
};

// =======================
// 👤 USER SCHEMA
// =======================
const UserSchema =
  new mongoose.Schema({
    firebaseUid: {
      type: String,
      required: true,
      unique: true,
    },

    email: {
      type: String,
    },

    displayName: {
      type: String,
      default: "User",
    },

    phone: String,

    balance: {
      type: Number,
      default: 0,
    },

    goldBalance: {
      type: Number,
      default: 0,
    },

    silverBalance: {
      type: Number,
      default: 0,
    },

    createdAt: {
      type: Date,
      default: Date.now,
    },
  });

UserSchema.index({ firebaseUid: 1 });
UserSchema.index({ createdAt: -1 });

const User = mongoose.model(
  "User",
  UserSchema
);

// =======================
// ⚙️ SETTINGS SCHEMA
// =======================
const SettingSchema =
  new mongoose.Schema({
    goldRate: {
      type: Number,
      default: 6000,
    },

    silverRate: {
      type: Number,
      default: 75,
    },

    goldWithdrawFee: {
      type: Number,
      default: 2.5,
    },

    silverWithdrawFee: {
      type: Number,
      default: 2.5,
    },

    fixedGoldCharge: {
      type: Number,
      default: 0,
    },

    fixedSilverCharge: {
      type: Number,
      default: 0,
    },

    lastUpdated: {
      type: Date,
      default: Date.now,
    },
  });

const Setting = mongoose.model(
  "Setting",
  SettingSchema
);

// =======================
// 📊 TRANSACTION SCHEMA
// =======================
const TransactionSchema =
  new mongoose.Schema({
    userId: String,

    userName: String,

    userEmail: String,

    amount: Number,

    metal: String,

    weight: Number,

    rate: Number,

    utr: {
      type: String,
      default: "",
    },

    type: {
      type: String,

      enum: [
        "investment",
        "withdrawal",
      ],

      default: "investment",
    },

    status: {
      type: String,

      enum: [
        "pending",
        "completed",
        "failed",
      ],

      default: "pending",
    },

    approvedAt: Date,

    rejectedAt: Date,

    date: {
      type: Date,
      default: Date.now,
    },
  });

TransactionSchema.index({ userId: 1 });
TransactionSchema.index({ status: 1 });
TransactionSchema.index({ type: 1 });

const Transaction =
  mongoose.model(
    "Transaction",
    TransactionSchema
  );

  

  // =====================================================
// 📊 ADMIN STATS
// =====================================================
app.get(
  "/api/admin/stats",
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
    try {

      // TOTAL USERS
      const totalUsers =
        await User.countDocuments();

      // TOTAL INVESTMENT
      const investmentAgg =
        await User.aggregate([
          {
            $group: {
              _id: null,
              total: {
                $sum: "$balance",
              },
            },
          },
        ]);

      // ALL TRANSACTIONS
      const transactions =
        await Transaction.find();

      // TOTAL ORDERS
      const totalOrders =
        transactions.length;

      // REVENUE
      let totalRevenue = 0;

      transactions.forEach((tx) => {
        if (
          tx.type === "withdrawal"
        ) {
          totalRevenue +=
            Number(tx.rate || 0);
        }
      });

      res.json({
        totalVolume:
          investmentAgg[0]
            ?.total || 0,

        activeUsers:
          totalUsers || 0,

        orders:
          totalOrders || 0,

        revenue:
          totalRevenue || 0,
      });

    } catch (err) {

      console.log(
        "Stats Error:",
        err
      );

      res.status(500).json({
        error:
          "Failed to fetch stats",
      });
    }
  }
);

// =====================================================
// 🔔 SEND NOTIFICATION
// =====================================================
app.post(
  "/api/notifications/send",
  async (req, res) => {
    try {
      const {
        uid,
        title,
        message,
        type,
      } = req.body;

      if (
        !uid ||
        !title ||
        !message
      ) {
        return res.status(400).json({
          success: false,
          error: "All fields are required",
        });
      }

      const notification =
        await Notification.create({
          uid,
          title,
          message,
          type: type || "info",
        });

      res.json({
        success: true,
        notification,
      });
    } catch (err) {
      console.log(err);

      res.status(500).json({
        success: false,
        error: "Failed to send notification",
      });
    }
  }
);

// =====================================================
// 🔔 GET USER NOTIFICATIONS
// =====================================================
app.get(
  "/api/notifications/:uid",
  async (req, res) => {
    try {
      const notifications =
        await Notification.find({
          uid: req.params.uid,
        }).sort({
          createdAt: -1,
        });

      res.json(notifications);
    } catch (err) {
      console.log(err);

      res.status(500).json({
        success: false,
        error: "Failed to fetch notifications",
      });
    }
  }
);

// =====================================================
// 🔴 GET UNREAD NOTIFICATION COUNT
// =====================================================
app.get(
  "/api/notifications/unread/:uid",
  async (req, res) => {
    try {

      const count =
        await Notification.countDocuments({
          uid: req.params.uid,
          read: false,
        });

      res.json({
        success: true,
        count,
      });

    } catch (err) {

      console.log(err);

      res.status(500).json({
        success: false,
        error:
          "Failed to fetch unread notifications",
      });
    }
  }
);

// =====================================================
// ✅ MARK NOTIFICATIONS AS READ
// =====================================================
app.put(
  "/api/notifications/read/:uid",
  async (req, res) => {
    try {

      await Notification.updateMany(
        {
          uid: req.params.uid,
          read: false,
        },

        {
          $set: {
            read: true,
          },
        }
      );

      res.json({
        success: true,
      });

    } catch (err) {

      console.log(err);

      res.status(500).json({
        success: false,
        error:
          "Failed to mark notifications as read",
      });
    }
  }
);


// =====================================================
// 🎁 ADMIN GIFT BALANCE
// =====================================================
app.post(
  "/api/admin/gift-balance",
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
    try {

      const {
        uid,
        metal,
        grams,
      } = req.body;

      // VALIDATION
      if (
        !uid ||
        !metal ||
        !grams
      ) {
        return res.status(400).json({
          success: false,
          error: "All fields are required",
        });
      }

      const field =
        metal === "gold"
          ? "goldBalance"
          : "silverBalance";

      // USER UPDATE
      const updatedUser =
        await User.findOneAndUpdate(
          {
            firebaseUid: uid,
          },

          {
            $inc: {
              [field]: Number(grams),
            },
          },

          {
            new: true,
          }
        );

      if (!updatedUser) {
        return res.status(404).json({
          success: false,
          error: "User not found",
        });
      }

      // OPTIONAL TRANSACTION SAVE
      await Transaction.create({
        userId: uid,

        userName:
          updatedUser.displayName,

        userEmail:
          updatedUser.email,

        type: "investment",

        metal,

        weight: Number(grams),

        amount: 0,

        rate: 0,

        status: "completed",

        date: new Date(),
      });

      res.json({
        success: true,
        message:
          `${grams}g ${metal} gifted successfully`,
        user: updatedUser,
      });

    } catch (err) {

      console.log(err);

      res.status(500).json({
        success: false,
        error:
          "Failed to gift balance",
      });
    }
  }
);


// =====================================================
// 🔐 AUTH SYNC
// =====================================================
app.post(
  "/api/auth/sync-user",
  async (req, res) => {
    try {
      const {
        uid,
        email,
        displayName,
        phone,
      } = req.body;

      if (!uid) {
        return res
          .status(400)
          .json({
            error:
              "UID is required",
          });
      }

      const updatedUser =
        await User.findOneAndUpdate(
          {
            firebaseUid:
              uid,
          },

          {
            $set: {
              email:
                email || "",

              displayName:
                displayName ||
                "User",

              phone:
                phone || "",
            },
          },

          {
            upsert: true,
            new: true,
          }
        );

      res.json(updatedUser);
    } catch (err) {
      console.error(
        "❌ Sync Error:",
        err
      );

      res.status(500).json({
        error:
          "Auth Sync Failed",
      });
    }
  }
);

// =====================================================
// 👤 USER BALANCE
// =====================================================
app.get(
  "/api/user/balance/:uid",
  async (req, res) => {
    try {
      let user =
        await User.findOne({
          firebaseUid:
            req.params.uid,
        });

      if (!user) {
        return res
          .status(404)
          .json({
            error:
              "User not found",
          });
      }

      let settings =
        await Setting.findOne();

      if (!settings) {
        settings =
          await Setting.create(
            {}
          );
      }

      res.json({
        cash:
          user.balance,

        gold:
          user.goldBalance,

        silver:
          user.silverBalance,

        goldRate:
          settings.goldRate,

        silverRate:
          settings.silverRate,

        displayName:
          user.displayName ||
          "User",

        email:
          user.email ||
          "No Email",
      });
    } catch (err) {
      res.status(500).json({
        error:
          "Error fetching balance",
      });
    }
  }
);

// =====================================================
// 💸 INVEST REQUEST
// =====================================================
app.post(
  "/api/user/invest",
  async (req, res) => {
    try {
      const {
        userId,
        amount,
        metal,
        email,
        displayName,
        utr,
      } = req.body;

      if (
        !userId ||
        !amount ||
        !metal
      ) {
        return res
          .status(400)
          .json({
            error:
              "Missing fields",
          });
      }

      let settings =
        await Setting.findOne();

      if (!settings) {
        settings =
          await Setting.create(
            {}
          );
      }

      const rate =
        metal === "gold"
          ? settings.goldRate
          : settings.silverRate;

      const weight =
        Number(amount) /
        Number(rate);

      // ✅ SIRF REQUEST SAVE HOGI
      // ❌ WALLET UPDATE NAHI HOGA

      const newTransaction =
        await Transaction.create({
          userId,

          userName:
            displayName ||
            "User",

          userEmail:
            email ||
            "No Email",

          amount:
            Number(amount),

          metal,

          weight,

          rate,

          utr:
            utr || "",

          type:
            "investment",

          status:
            "pending",
        });

      res.json({
        success: true,

        message:
          "Investment request created successfully",

        transaction:
          newTransaction,
      });
    } catch (err) {
      console.log(err);

      res.status(500).json({
        error:
          "Investment failed",
      });
    }
  }
);

// =====================================================
// ✅ ADMIN APPROVE INVESTMENT
// =====================================================
app.post(
  "/api/admin/approve-investment",
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
    const session =
      await mongoose.startSession();

    session.startTransaction();

    try {
      const {
        transactionId,
      } = req.body;

      const tx =
        await Transaction.findById(
          transactionId
        ).session(session);

      if (!tx) {
        throw new Error(
          "Transaction not found"
        );
      }

      // ❌ Already approved/rejected
      if (
        tx.status !==
        "pending"
      ) {
        throw new Error(
          "Transaction already processed"
        );
      }

      const field =
        tx.metal === "gold"
          ? "goldBalance"
          : "silverBalance";

      // ✅ USER WALLET UPDATE ONLY ON APPROVE
      const updatedUser =
        await User.findOneAndUpdate(
          {
            firebaseUid:
              tx.userId,
          },

          {
            $inc: {
              [field]:
                Number(
                  tx.weight
                ),

              balance:
                Number(
                  tx.amount
                ),
            },
          },

          {
            session,
            new: true,
          }
        );

      if (!updatedUser) {
        throw new Error(
          "User not found"
        );
      }

      // ✅ TRANSACTION COMPLETE
      tx.status =
        "completed";

      tx.approvedAt =
        new Date();

      await tx.save({
        session,
      });

      await session.commitTransaction();

      res.json({
        success: true,

        message:
          "Investment approved successfully",

        updatedBalance:
          updatedUser,
      });
    } catch (err) {
      await session.abortTransaction();

      console.log(err);

      res.status(500).json({
        error:
          err.message,
      });
    } finally {
      session.endSession();
    }
  }
);

// =====================================================
// ❌ ADMIN REJECT INVESTMENT
// =====================================================
app.post(
  "/api/admin/reject-investment",
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
    try {
      const {
        transactionId,
      } = req.body;

      const tx =
        await Transaction.findById(
          transactionId
        );

      if (!tx) {
        return res
          .status(404)
          .json({
            error:
              "Transaction not found",
          });
      }

      // ❌ Agar already approve/reject hai
      if (
        tx.status !==
        "pending"
      ) {
        return res
          .status(400)
          .json({
            error:
              "Already processed",
          });
      }

      // ✅ SIRF FAILED MARK HOGA
      // ❌ USER WALLET ME KUCH ADD NAHI HOGA

      tx.status = "failed";

      tx.rejectedAt =
        new Date();

      await tx.save();

      res.json({
        success: true,

        message:
          "Investment rejected successfully",
      });
    } catch (err) {
      console.log(err);

      res.status(500).json({
        error:
          "Reject failed",
      });
    }
  }
);

// =====================================================
// 🏧 WITHDRAW
// =====================================================
app.post(
  "/api/user/withdraw",
  async (req, res) => {
    const session =
      await mongoose.startSession();

    session.startTransaction();

    try {
      const {
        uid,
        assetType,
        grams,
        payoutAmount,
        charges,
      } = req.body;

      const field =
        assetType ===
        "gold"
          ? "goldBalance"
          : "silverBalance";

      const user =
        await User.findOneAndUpdate(
          {
            firebaseUid:
              uid,

            [field]: {
              $gte:
                Number(
                  grams
                ),
            },
          },

          {
            $inc: {
              [field]:
                -Number(
                  grams
                ),
            },
          },

          {
            session,
            new: true,
          }
        );

      if (!user) {
        await session.abortTransaction();

        return res
          .status(400)
          .json({
            error:
              "Insufficient balance",
          });
      }

      await Transaction.create(
        [
          {
            userId: uid,

            userName:
              user.displayName,

            userEmail:
              user.email,

            type:
              "withdrawal",

            metal:
              assetType,

            weight:
              Number(
                grams
              ),

            amount:
              Number(
                payoutAmount
              ),

            rate:
              Number(
                charges ||
                  0
              ),

            status:
              "pending",

            date:
              new Date(),
          },
        ],

        {
          session,
        }
      );

      await session.commitTransaction();

      res.json({
        success: true,
      });
    } catch (err) {
      if (
        session.inTransaction()
      ) {
        await session.abortTransaction();
      }

      res.status(500).json({
        error:
          err.message,
      });
    } finally {
      session.endSession();
    }
  }
);

// =====================================================
// 👨‍💼 ADMIN USERS
// =====================================================
app.get(
  "/api/admin/users",
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
    try {

      // ✅ ALL USERS
      const users = await User.find(
        {},
        "displayName email phone createdAt balance firebaseUid"
      )
        .sort({ createdAt: -1 })
        .lean();

      // ✅ SINGLE TRANSACTION QUERY
      const allTransactions =
        await Transaction.find(
          {},
          "userId type status amount"
        ).lean();

      // ✅ FINAL USERS
      const finalUsers = users.map(
        (u) => {

          // USER KE TRANSACTIONS
          const tx =
            allTransactions.filter(
              (t) =>
                t.userId ===
                u.firebaseUid
            );

          return {
            ...u,

            // ✅ TOTAL INVESTMENT
            totalInvested: tx
              .filter(
                (t) =>
                  t.type ===
                    "investment" &&
                  t.status ===
                    "completed"
              )
              .reduce(
                (sum, t) =>
                  sum +
                  Number(
                    t.amount || 0
                  ),
                0
              ),

            // ✅ TRANSACTION COUNT
            transactionCount:
              tx.length,
          };
        }
      );

      res.json(finalUsers);

    } catch (err) {

      console.log(err);

      res.status(500).json({
        error: "Users fetch failed",
      });
    }
  }
);

// =====================================================
// ⚙️ SETTINGS
// =====================================================
app.get(
  "/api/admin/settings",
  async (req, res) => {
    try {
      let settings =
        await Setting.findOne();

      if (!settings) {
        settings =
          await Setting.create(
            {}
          );
      }

      res.json(settings);
    } catch (err) {
      res.status(500).json({
        error:
          "Settings fetch failed",
      });
    }
  }
);

app.post(
  "/api/admin/update-settings",
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
    try {
      const updatedSettings =
        await Setting.findOneAndUpdate(
          {},

          {
            ...req.body,

            lastUpdated:
              Date.now(),
          },

          {
            upsert: true,

            new: true,
          }
        );

      res.json({
        success: true,

        settings:
          updatedSettings,
      });
    } catch (err) {
      res.status(500).json({
        error:
          "Failed to update settings",
      });
    }
  }
);

// =====================================================
// 📜 USER TRANSACTIONS
// =====================================================
app.get(
  "/api/user/transactions/:uid",
  async (req, res) => {
    try {
      const { uid } =
        req.params;

      const user =
        await User.findOne({
          firebaseUid:
            uid,
        });

      if (!user) {
        return res
          .status(404)
          .json({
            error:
              "User not found",
          });
      }

      const transactions =
        await Transaction.find(
          {
            userId: uid,
          }
        ).sort({
          date: -1,
        });

      res.json({
        email:
          user.email ||
          "No Email",

        displayName:
          user.displayName ||
          "Investor",

        goldBalance:
          user.goldBalance ||
          0,

        silverBalance:
          user.silverBalance ||
          0,

        transactions:
          transactions ||
          [],
      });
    } catch (err) {
      console.error(
        "Fetch error:",
        err
      );

      res.status(500).json({
        error:
          "Fetch failed",
      });
    }
  }
);

// =====================================================
// 📜 ALL TRANSACTIONS
// =====================================================
app.get(
  "/api/admin/all-transactions",
  authMiddleware,
  adminMiddleware,
  async (req, res) => {
    try {
      const transactions =
        await Transaction.find().sort(
          {
            date: -1,
          }
        );

      res.json(
        transactions
      );
    } catch (err) {
      res.status(500).json({
        error:
          "Fetch failed",
      });
    }
  }
);

// =======================
// 🌍 ROOT ROUTE
// =======================

app.get("/", (req, res) => {
  res.send("🚀 SR Gold Wallet Backend Running Successfully");
});

// =======================
// 🚀 START SERVER
// =======================

const PORT = process.env.PORT || 5000;

app.listen(PORT, () =>
  console.log(`🚀 Server running on port ${PORT}`)
);