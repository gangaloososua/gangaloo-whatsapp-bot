const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const {
  VERIFY_TOKEN,
  WHATSAPP_TOKEN,
  PHONE_NUMBER_ID,
  ANTHROPIC_API_KEY,
} = process.env;

const STORE_INFO = {
  nombre: "GangaLoo",
  tienda: "https://gangaloo.netlify.app/store",
  cotizador: "https://gangaloo.netlify.app/cotizador-gangaloo",
  descripcion: "Tienda especializada en cabello humano, pelucas, accesorios de belleza, y servicio de compras por encargo desde Shein, Temu, Amazon y AliExpress.",
  sucursales: [
    {
      nombre: "GangaLoo Montellano",
      direccion: "Montellano, Espaillat, Republica Dominicana",
      horario: "Lun-Sab: 8:00am - 6:30pm | Dom: cerrado",
    },
    {
      nombre: "GangaLoo Sosua / Maranata",
      direccion: "Sosua / Maranata, Puerto Plata, Rep. Dom.",
      horario: "Lun-Sab: 8:00am - 7:00pm | Dom: 9:00am - 1:00pm",
    },
  ],
  categorias_tienda: [
    "Cabellos 9A", "Cabellos 12A", "Cabellos 8A",
    "Pelucas Lacio", "Pelucas Ondulado", "Pelucas Rizado", "Pelucas Sinteticos",
    "Frontales", "Accesorios para Pelucas", "Accesorios de Belleza", "Salud y Bienestar",
  ],
  servicio_encargo: {
    plataformas: ["Shein", "Temu", "Amazon", "AliExpress"],
    cotizador: "https://gangaloo.netlify.app/cotizador-gangaloo",
    opciones_pago: ["100% adelantado", "50% ahora + 50% al recibir"],
    como_ordenar: "El cliente manda el link o screenshot del carrito por WhatsApp.",
    como_pagar: ["Efectivo en Maranata (Sosua)", "Transferencia bancaria (Banreservas, BHD, Popular)"],
  },
  pagos_tienda: ["Efectivo", "Transferencia bancaria (Banreservas, BHD, Popular)", "Tarjeta de credito/debito", "PayPal"],
  delivery: "Enviamos a toda la Republica Dominicana. Pedidos locales: 24-48h. Interior del pais: 3-5 dias laborables.",
  redes: "Facebook: GangaLoo | Instagram: @GangaLoo | TikTok: @GangaLoo | YouTube: GangaLoo",
};

const HANDOFF_FOOTER = "\n\n_¿Prefieres hablar con una persona? Escribe *agente* para conectarte con Bernhard Antony Perkins_ 👤";

const SYSTEM_PROMPT = `Eres GangaBot, el asistente de WhatsApp de GangaLoo - una tienda especializada en cabello humano, pelucas, accesorios de belleza, y servicio de compras por encargo desde Shein, Temu, Amazon y AliExpress. Sucursales en Montellano y Sosua/Maranata, Republica Dominicana.

Personalidad: casual, amigable, dominicana. Habla como una experta. Usa expresiones como "Claro que si!", "Con gusto!", "Tenemos justo lo que buscas!". Emojis moderados (1-2 por mensaje). Responde SIEMPRE en espanol. Maximo 6 lineas. Directa y util.

INFORMACION COMPLETA:
${JSON.stringify(STORE_INFO, null, 2)}

REGLAS POR TEMA:

PRODUCTOS DE LA TIENDA (cabello, pelucas):
- Menciona categorias relevantes y SIEMPRE manda: https://gangaloo.netlify.app/store
- Grados: 8A = buena calidad, 9A = mejor, 12A = la mejor y mas duradera.
- Pelucas: Lacio, Ondulado, Rizado y Sinteticos.

PEDIDOS POR ENCARGO (Shein, Temu, Amazon, AliExpress):
- SIEMPRE manda el cotizador: https://gangaloo.netlify.app/cotizador-gangaloo
- Solo ingresa el precio del carrito y ve cuanto paga.
- Opciones: 100% adelantado O 50% ahora + 50% al recibir.
- Para ordenar: cliente manda link o screenshot del carrito por WhatsApp.
- Pago: efectivo en Maranata (Sosua) O transferencia bancaria.
- Flujo: "1) Calcula en el cotizador 2) Mandanos tu carrito 3) Confirma el pago y hacemos el pedido!"

HORARIOS: da info de ambas sucursales.
PAGOS TIENDA: lista todos los metodos.
ENVIOS: explica brevemente.
PRECIOS: nunca inventes precios especificos.
SIN RESPUESTA: "Te conecto con un agente ahora mismo"
SIEMPRE termina con una pregunta o invitacion a continuar.

IMPORTANTE: No agregues ningun pie de mensaje al final de tu respuesta. Eso se maneja por separado.`;

// Tracks which conversations have been handed off to a human
const handedOffConversations = new Set();
const conversations = new Map();

function getHistory(phone) {
  if (!conversations.has(phone)) conversations.set(phone, []);
  return conversations.get(phone);
}

function addToHistory(phone, role, content) {
  const history = getHistory(phone);
  history.push({ role, content });
  if (history.length > 10) history.splice(0, history.length - 10);
}

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

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verified by Meta");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  try {
    const body = req.body;

    if (
      body.object !== "whatsapp_business_account" ||
      !body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]
    ) return;

    const message = body.entry[0].changes[0].value.messages[0];
    const from = message.from;

    if (message.type !== "text") {
      await sendWhatsAppMessage(from, "Hola! Solo puedo leer mensajes de texto por ahora. En que te puedo ayudar?" + HANDOFF_FOOTER);
      return;
    }

    const userText = message.text.body.trim();
    console.log(`Message from ${from}: ${userText}`);

    // Check if client wants a human agent
    const wantsAgent = /\bagente\b/i.test(userText) ||
      /hablar con (una )?persona/i.test(userText) ||
      /persona real/i.test(userText) ||
      /humano/i.test(userText);

    if (wantsAgent) {
      // Mark this conversation as handed off
      handedOffConversations.add(from);
      const handoffMsg = "Claro que si! Te estoy conectando con *Bernhard Antony Perkins* ahora mismo. El te atendera en breve. Gracias por tu paciencia! 🙏";
      await sendWhatsAppMessage(from, handoffMsg);
      console.log(`Conversation ${from} handed off to human agent`);
      return;
    }

    // If conversation is handed off, bot stays silent
    if (handedOffConversations.has(from)) {
      console.log(`Conversation ${from} is with human agent - bot staying silent`);
      return;
    }

    // Bot handles the message
    const reply = await askClaude(from, userText);
    const replyWithFooter = reply + HANDOFF_FOOTER;
    console.log(`GangaBot reply to ${from}: ${reply}`);

    await sendWhatsAppMessage(from, replyWithFooter);

  } catch (error) {
    console.error("Error:", error.response?.data || error.message);
  }
});

// Endpoint to reactivate bot for a conversation (call this after you finish with the client)
// Example: POST https://gangaloo-whatsapp-bot.onrender.com/reactivate with body { "phone": "18091234567" }
app.post("/reactivate", (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: "Phone number required" });
  handedOffConversations.delete(phone);
  conversations.delete(phone); // also clear chat history so bot starts fresh
  console.log(`Bot reactivated for ${phone}`);
  res.json({ success: true, message: `Bot reactivated for ${phone}` });
});

app.get("/", (req, res) => {
  res.json({ status: "GangaBot is running!", store: "GangaLoo" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`GangaBot running on port ${PORT}`));
