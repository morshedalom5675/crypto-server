require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const port = process.env.PORT || 3000;

const app = express();

// --- ১. CORS ফিক্স (Boolean Filter ব্যবহার করা হয়েছে যেন undefined লিঙ্ক ঝামেলা না করে) ---
const origins = [process.env.localhost_URL, process.env.netlify_URL].filter(
  Boolean,
);

app.use(
  cors({
    origin: origins,
    credentials: true,
  }),
);
app.use(express.json());

// --- ২. URI এবং প্রোডাকশন কানেকশন ফিক্স ---
const uri = process.env.mongoDB_uri;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // প্রোডাকশনে কানেকশন স্ট্যাবল রাখতে নিচের লাইনটি কমেন্ট আউট রাখাই ভালো (Vercel Serverless এর জন্য)
    // await client.connect();

    const db = client.db("ZenithX_Crypto");
    const usersCollection = db.collection("users");
    const paymentsCollection = db.collection("payments");
    const sellersCollection = db.collection("sellers");

    // --- User Related API ---
    app.post("/users", async (req, res) => {
      const user = req.body;
      const existingUser = await usersCollection.findOne({ email: user.email });
      if (existingUser) {
        return res.send({ message: "User already existing", insertedId: null });
      }
      const newUser = {
        ...user,
        role: user.role || "user",
        balance: user.balance || 0,
        createdAt: new Date().toISOString(),
      };
      const result = await usersCollection.insertOne(newUser);
      res.send(result);
    });

    app.get("/user/:email", async (req, res) => {
      const email = req.params.email;
      const result = await usersCollection.findOne({ email: email });
      res.send(result);
    });

    app.patch("/user/update/:email", async (req, res) => {
      const email = req.params.email;
      const { name, phone, image } = req.body;
      const filter = { email: email };
      const updateDoc = { $set: { name, phone, image } };
      try {
        const result = await usersCollection.updateOne(filter, updateDoc);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to update profile", error });
      }
    });

    app.get("/admin/users", async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });

    app.patch("/admin/users/role/:id", async (req, res) => {
      const id = req.params.id;
      const { role } = req.body;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = { $set: { role: role } };
      const result = await usersCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    app.delete("/admin/users/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await usersCollection.deleteOne(query);
      res.send(result);
    });

    // --- Payment Related API ---
    app.post("/payments", async (req, res) => {
      const payment = req.body;
      const alreadyExists = await paymentsCollection.findOne({
        transactionId: payment.transactionId,
      });
      if (alreadyExists) {
        return res
          .status(400)
          .send({
            success: false,
            message: "This Transaction ID has already been used!",
          });
      }
      const result = await paymentsCollection.insertOne(payment);
      res.send(result);
    });

    app.get("/my-payments/:email", async (req, res) => {
      const email = req.params.email;
      const result = await paymentsCollection
        .find({ email: email })
        .sort({ createdAt: -1 })
        .toArray();
      res.send(result);
    });

    app.get("/admin/payments", async (req, res) => {
      const result = await paymentsCollection
        .find()
        .sort({ createdAt: -1 })
        .toArray();
      res.send(result);
    });

    app.patch("/admin/approve-payment/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const payment = await paymentsCollection.findOne(filter);
      if (!payment || payment.status !== "pending") {
        return res
          .status(400)
          .send({ message: "Already processed or not found" });
      }
      await paymentsCollection.updateOne(filter, {
        $set: { status: "approved" },
      });
      await usersCollection.updateOne(
        { email: payment.email },
        { $inc: { balance: payment.amount } },
      );
      res.send({ success: true });
    });

    app.patch("/admin/reject-payment/:id", async (req, res) => {
      const id = req.params.id;
      const result = await paymentsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status: "rejected" } },
      );
      res.send(result);
    });

    // --- Seller/Merchant Request API ---
    app.post("/seller-requests", async (req, res) => {
      const request = req.body;
      const alreadyExists = await sellersCollection.findOne({
        email: request.email,
      });
      if (alreadyExists) {
        return res
          .status(400)
          .send({ success: false, message: "You have already applied!" });
      }
      const result = await sellersCollection.insertOne(request);
      res.send(result);
    });

    app.get("/admin/seller-requests", async (req, res) => {
      const result = await sellersCollection
        .find()
        .sort({ appliedAt: -1 })
        .toArray();
      res.send(result);
    });

    app.patch("/admin/approve-seller/:id", async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      await sellersCollection.updateOne(filter, {
        $set: { status: "approved", isVerified: true },
      });
      const sellerData = await sellersCollection.findOne(filter);
      if (sellerData) {
        await usersCollection.updateOne(
          { email: sellerData.email },
          { $set: { role: "seller" } },
        );
      }
      res.send({ success: true });
    });

    app.delete("/admin/reject-seller/:id", async (req, res) => {
      const id = req.params.id;
      const result = await sellersCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    app.get("/sellers/approved", async (req, res) => {
      const result = await sellersCollection
        .find({ status: "approved" })
        .toArray();
      res.send(result);
    });

    console.log("Successfully connected to MongoDB!");
  } catch (error) {
    console.error("MongoDB Connection Error:", error);
  }
}
run().catch(console.dir);

app.get("/", (req, res) => res.send("ZenithX Server is Running"));
app.listen(port, () => console.log(`Server is running on port ${port}`));
