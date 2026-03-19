const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// ─── CONFIG (set these in Render.com environment variables) ───────────────────
const {
  VERIFY_TOKEN,          // any secret string you choose, e.g. "gangaloo2026"
  WHATSAPP_TOKEN,        // your Meta permanent access token
  PHONE_NUMBER_ID,       // from Meta developer dashboard
  ANTHROPIC_API_KEY,     // your Claude API key
} = process.env;

// ─── STORE INFO ───────────────────────────────────────────────────────────────
const STORE_INFO = {
  nombre: "GangaLoo",
  sucursales: [
    {
      nombre: "GangaLoo Montellano",
      direccion: "Montellano, Espaillat, República Dominicana",
      horario: "Lun–Sáb: 8:00am – 6:30pm | Dom: cerrado",
    },
    {
      nombre: "GangaLoo Sosúa / Maranatá",
      direccion: "Sosúa / Maranatá, Puerto Plata, Rep. Dom.",
      horario: "Lun–Sáb: 8:00am – 7:00pm | Dom: 9:00am – 1:00pm",
    },
  ],
  pagos: ["Efectivo", "Transferencia bancaria (Banreservas, BHD, Popular)", "Tarjeta de crédito/débito", "PayPal"],
  delivery: "Realizamos envíos a toda la República Dominicana. Pedidos locales: 24–48h. Interior del país: 3–5 días laborables.",
  catalogo: "Visita gangaloo.netlify.app para ver el catálogo completo con precios actualizados.",
  cotizacion: "Pídele al cliente el producto y la cantidad. Confirma que vas a buscar el precio.",
  redes: "Facebook: GangaLoo | Instagram: @GangaLoo | TikTok: @GangaLoo | YouTube: GangaLoo",
};

const SYSTEM_PROMPT = `Eres GangaBot, el asistente de WhatsApp de GangaLoo — una tienda en la República Dominicana con sucursales en Montellano y Sosúa/Maranatá.

Personalidad: casual, amigable, dominicano. Habla natural. Usa expresiones como "¡Claro que sí!", "¡Con gusto!", "¡No te preocupes!". Emojis con moderación. Responde en español siempre. Máximo 4–5 líneas. Directo y útil.

INFORMACIÓN DE LA TIENDA:
${JSON.stringify(STORE_INFO, null, 2)}

REGLAS:
- Horarios/ubicación → da info de ambas sucursales.
- Catálogo/precios → dirige a gangaloo.netlify.app.
- Cotización → pide producto y cantidad: "¡Dime qué necesitas y te doy el precio al tiro!"
- Pagos → lista todos los métodos.
- Envíos → explica la política de forma simple.
- Redes sociales → da los handles.
- Si no puedes resolver algo → "Te conecto con un agente ahora mismo 👌"
- Nunca inventes precios. Termina siempre con una pregunta o invitación a seguir.`;

// ─── IN-MEMORY CONVERSATION HISTORY ──────────────────────────────────────────
// Stores last 10 messages per phone number to maintain context
const conversations = new Map();

function getHistory(phone) {
  if (!conversations.has(phone)) conversations.set(phone, []);
  return conversations.get(phone);
}

function addToHistory(phone, role, content) {
  const history = getHistory(phone);
  history.push({ role, content });
  // Keep only last 10 messages to avoid token overflow
  if (history.length > 10) history.splice(0, history.length - 10);
}

// ─── CLAUDE API ───────────────────────────────────────────────────────────────
async function askClaude(phone, userMessage) {
  addToHistory(phone, "user", userMessage);
  const history = getHistory(phone);

  const response = await axios.post(
    "https://api.anthropic.com/v1/messages",
    {
      model: "claude-sonnet-4-20250514",
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages: history,
    },
    {
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
    }
  );

  const reply = response.data.content[0].text;
  addToHistory(phone, "assistant", reply);
  return reply;
}

// ─── WHATSAPP API ─────────────────────────────────────────────────────────────
async function sendWhatsAppMessage(to, message) {
  await axios.post(
    `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: message },
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
}

// ─── WEBHOOK VERIFICATION (Meta requires this) ────────────────────────────────
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verified by Meta");
    res.status(200).send(challenge);
  } else {
    console.error("❌ Webhook verification failed");
    res.sendStatus(403);
  }
});

// ─── INCOMING MESSAGES ────────────────────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  // Always acknowledge immediately so Meta doesn't retry
  res.sendStatus(200);

  try {
    const body = req.body;

    // Validate it's a WhatsApp message
    if (
      body.object !== "whatsapp_business_account" ||
      !body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]
    ) return;

    const message = body.entry[0].changes[0].value.messages[0];
    const from = message.from; // sender's phone number

    // Only handle text messages for now
    if (message.type !== "text") {
      await sendWhatsAppMessage(from, "¡Hola! 👋 Por ahora solo puedo leer mensajes de texto. ¿En qué te puedo ayudar?");
      return;
    }

    const userText = message.text.body;
    console.log(`📨 Message from ${from}: ${userText}`);

    // Get Claude's reply
    const reply = await askClaude(from, userText);
    console.log(`🤖 GangaBot reply: ${reply}`);

    // Send back to WhatsApp
    await sendWhatsAppMessage(from, reply);

  } catch (error) {
    console.error("❌ Error processing message:", error.response?.data || error.message);
  }
});

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({ status: "GangaBot is running! 🚀", store: "GangaLoo" });
});

// ─── START SERVER ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 GangaBot running on port ${PORT}`));
