require("dotenv").config();
const express = require("express");
const twilio = require("twilio");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const userUsage = {};
const FREE_LIMIT = 100;

const SYSTEM_PROMPT = `You are StudyBot, an AI tutor built specifically for Nigerian and African university students.
Your job is to:
- Explain difficult topics in simple, clear language
- Solve assignments step by step
- Summarize lecture notes
- Generate quiz questions and flashcards
- Help students prepare for exams quickly
- Create cram sheets and revision summaries

Your tone should be:
- Friendly and encouraging like a helpful senior student
- Simple and beginner-friendly
- Direct and concise unless the student asks for detail
- Use Nigerian context and examples where helpful

When a student says "I have exam tomorrow" or "exam rush", automatically:
1. Ask what subject/topic
2. Generate a quick revision summary
3. List likely exam questions
4. Give key formulas or definitions to memorize

Always end responses with a helpful follow-up suggestion.`;

async function askGemini(userMessage, imageBase64 = null, mimeType = null) {
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
  let parts = [];
  if (imageBase64) {
    parts.push({ inlineData: { data: imageBase64, mimeType: mimeType || "image/jpeg" } });
    parts.push({ text: `${SYSTEM_PROMPT}\n\nThe student sent this image. Read it and help them. Their message: ${userMessage || "Please explain this image/assignment for me."}` });
  } else {
    parts.push({ text: `${SYSTEM_PROMPT}\n\nStudent: ${userMessage}` });
  }
  const result = await model.generateContent(parts);
  return result.response.text();
}

async function sendWhatsApp(to, message) {
  const chunks = message.match(/.{1,1500}/gs) || [message];
  for (const chunk of chunks) {
    await client.messages.create({
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to: to,
      body: chunk
    });
  }
}

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  const from = req.body.From;
  const body = req.body.Body?.trim() || "";
  const mediaUrl = req.body.MediaUrl0;
  const mediaType = req.body.MediaContentType0;
  const numMedia = parseInt(req.body.NumMedia || "0");

  if (!userUsage[from]) userUsage[from] = 0;

  if (userUsage[from] >= FREE_LIMIT) {
    await sendWhatsApp(from, `⚠️ You've reached your free daily limit of ${FREE_LIMIT} questions.\n\nUpgrade to premium:\n- ₦500/week\n- ₦1500/month\n\nReply REFERRAL to earn free questions by inviting friends!`);
    return;
  }

  if (body.toLowerCase() === "hi" || body.toLowerCase() === "hello" || body.toLowerCase() === "start") {
    await sendWhatsApp(from, `👋 Hello! I'm *StudyBot*, your 24/7 AI study assistant.\n\nWhat are you studying today? Just ask me anything or send a photo of your notes! 📚`);
    return;
  }

  if (body.toLowerCase() === "referral") {
    await sendWhatsApp(from, `🎁 *Referral Rewards*\n\n- 1 friend = +100 questions\n- 3 friends = 3 days premium\n- 5 friends = 1 week premium\n- 10 friends = 1 month FREE!\n\nYour referral link:\nhttps://studybot.app/ref/${from.replace("whatsapp:+", "")}`);
    return;
  }

  try {
    let reply = "";
    if (numMedia > 0 && mediaUrl) {
      await sendWhatsApp(from, "📸 Got your image! Reading it now...");
      const authHeader = "Basic " + Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
      const imageResponse = await fetch(mediaUrl, { headers: { Authorization: authHeader } });
      const arrayBuffer = await imageResponse.arrayBuffer();
      const imageBase64 = Buffer.from(arrayBuffer).toString("base64");
      reply = await askGemini(body, imageBase64, mediaType);
    } else {
      reply = await askGemini(body);
    }

    userUsage[from]++;
    const remaining = FREE_LIMIT - userUsage[from];
    if (remaining <= 10) {
      reply += `\n\n⚠️ You have ${remaining} free questions left today.`;
    }
    await sendWhatsApp(from, reply);
  } catch (error) {
    console.error("Error:", error);
    await sendWhatsApp(from, "⚠️ Something went wrong. Please try again in a moment.");
  }
});

app.get("/", (req, res) => {
  res.send("StudyBot is running ✅");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`StudyBot running on port ${PORT}`));
