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

// Supabase config
const SUPABASE_URL = "https://xnbkwczolkinurohloxj.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhuYmt3Y3pvbGtpbnVyb2hsb3hqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4MTA5ODEsImV4cCI6MjA4ODM4Njk4MX0.qkSgk5BUccKF-bmla5nOFgI4HIPox40X6jYDT4Zcnes";

// Fetch live inventory from Supabase
async function getInventory() {
  try {
    const response = await axios.get(
      `${SUPABASE_URL}/rest/v1/inventory_data?select=warehouses,categories,products&limit=1`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const row = response.data[0];
    if (!row) return null;

    // Parse JSON fields if they are strings
    const warehouses = typeof row.warehouses === "string" ? JSON.parse(row.warehouses) : row.warehouses;
    const categories = typeof row.categories === "string" ? JSON.parse(row.categories) : row.categories;
    const products = typeof row.products === "string" ? JSON.parse(row.products) : row.products;

    return { warehouses, categories, products };
  } catch (err) {
    console.error("Supabase fetch error:", err.message);
    return null;
  }
}

// Build a readable inventory summary for Claude
function buildInventorySummary(data) {
  if (!data) return "Inventario no disponible en este momento.";

  const { warehouses, categories, products } = data;

  // Build warehouse name map
  const warehouseMap = {};
  if (Array.isArray(warehouses)) {
    warehouses.forEach(w => { warehouseMap[w.id] = w.name; });
  }

  // Build category name map
  const categoryMap = {};
  if (Array.isArray(categories)) {
    categories.forEach(c => { categoryMap[c.id] = c.name; });
  }

  // Group products by warehouse and category
  const summary = {};
  if (Array.isArray(products)) {
    products.forEach(p => {
      const whName = warehouseMap[p.warehouseId] || warehouseMap[p.warehouse_id] || p.warehouseId || "Almacen desconocido";
      const catName = categoryMap[p.categoryId] || categoryMap[p.category_id] || p.categoryId || "Sin categoria";
      const key = `${whName} - ${catName}`;
      if (!summary[key]) summary[key] = [];
      const stock = p.stock !== undefined ? p.stock : (p.quantity !== undefined ? p.quantity : "?");
      if (stock > 0 || stock === "?") {
        summary[key].push(`${p.name || p.sku} (stock: ${stock})`);
      }
    });
  }

  if (Object.keys(summary).length === 0) {
    return "No hay productos con stock disponible en este momento.";
  }

  let result = "INVENTARIO ACTUAL:\n";
  for (const [location, items] of Object.entries(summary)) {
    result += `\n📦 ${location}:\n`;
    items.slice(0, 10).forEach(item => { result += `  - ${item}\n`; });
    if (items.length > 10) result += `  ... y ${items.length - 10} productos mas\n`;
  }
  return result;
}

const STORE_INFO = {
  nombre: "GangaLoo",
  tienda: "https://gangaloo.netlify.app/store",
  cotizador: "https://gangaloo.netlify.app/cotizador-gangaloo",
  sucursales: [
    {
      nombre: "GangaLoo Montellano",
      direccion: "Pancho Mateo, Montellano, Republica Dominicana",
      horario: "Lunes a Domingo: 9:00 AM - 7:00 PM",
      telefono: "+1 (829) 841-7980",
      maps: "https://www.google.com/maps?q=19.7299357,-70.5980177",
    },
    {
      nombre: "GangaLoo Maranatha (Sosua)",
      direccion: "Calle Bella Vista, Maranatha, Republica Dominicana",
      horario_semana: "Lunes a Viernes: 10:00 AM - 2:00 PM y 4:00 PM - 7:00 PM",
      horario_sabado: "Sabado: 2:00 PM - 6:00 PM",
      horario_domingo: "Domingo: Cerrado",
      telefono: "+1 (829) 286-7868",
      maps: "https://www.google.com/maps?q=19.7411172,-70.5228458",
    },
  ],
  extensiones_cabello: {
    calidades: ["8A - buena calidad", "9A - mejor calidad", "12A - calidad premium, la mejor"],
    nota: "Mayor numero = mejor calidad y mas duradera",
  },
  pelucas: {
    estilos: ["Lacio", "Ondulado", "Rizo", "Rizo Suave"],
    tipos: ["Cabello humano", "Sintetico"],
    extras: "Multiples colores, diferentes largos, Bob corto disponible",
  },
  servicio_encargo: {
    plataformas: ["Shein", "Temu", "Amazon", "AliExpress", "eBay"],
    opciones_pago: ["100% adelantado", "50% ahora + 50% al recibir (+20% cargo financiero)"],
    como_pagar: ["Efectivo en Maranatha", "Transferencia bancaria (Banreservas, BHD, Popular)"],
  },
  pagos_tienda: ["Efectivo", "Transferencia bancaria", "Tarjeta credito/debito", "PayPal"],
  delivery: "Toda la RD. Local: 24-48h. Interior: 3-5 dias laborables.",
  ganar_dinero: ["Cashback hasta 15%", "Mayorista -20%", "Vendedor 5-15% comision", "Distribuidor territorio exclusivo", "Club GangaLoo RD$999/mes = 15-25% descuento"],
};

const HANDOFF_FOOTER = "\n\n_Prefieres hablar con una persona? Escribe *agente* para conectarte con Bernhard Antony Perkins_ 👤";

function buildSystemPrompt(inventorySummary) {
  return `Eres GangaBot, experta en cabello y asistente de WhatsApp de GangaLoo - tienda en Republica Dominicana especializada en extensiones de cabello humano, pelucas y accesorios de belleza.

Personalidad: casual, amigable, dominicana, experta en cabello. Usa "Claro que si!", "Con gusto!", "Tenemos justo lo que buscas!". Emojis moderados (1-2). Responde SIEMPRE en espanol. Maximo 8 lineas. Directa y util.

INFORMACION DE LA TIENDA:
${JSON.stringify(STORE_INFO, null, 2)}

${inventorySummary}

REGLAS:

INVENTARIO EN VIVO:
- Usa el inventario de arriba para responder preguntas sobre disponibilidad.
- Si un producto tiene stock > 0 → esta disponible.
- Si no aparece en el inventario → probablemente no hay stock, sugiere visitar la tienda online o preguntar a un agente.
- SIEMPRE menciona en cual almacen (Montellano o Maranatha) esta disponible.
- SIEMPRE recuerda al cliente cambiar entre almacenes en https://gangaloo.netlify.app/store para ver disponibilidad completa.

EXTENSIONES: 8A=buena, 9A=mejor, 12A=premium. Mayor numero = mejor calidad.
PELUCAS: Lacio, Ondulado, Rizo, Rizo Suave. Humano y sintetico. Multiples colores. Bob corto disponible.
UBICACION: dar direccion, horario, telefono y link de Maps de la sucursal que pregunten.
ENCARGOS (Shein/Temu/Amazon/AliExpress): mandar https://gangaloo.netlify.app/cotizador-gangaloo
PAGOS: listar todos los metodos.
ENVIOS: explicar brevemente.
PRECIOS: NUNCA inventes. Mandar a tienda online.
SIN RESPUESTA: "Te conecto con un agente ahora mismo"
SIEMPRE termina con pregunta o invitacion.
NO agregues pie de mensaje al final.`;
}

const handedOffConversations = new Set();
const conversations = new Map();

// Cache inventory for 5 minutes to avoid too many Supabase calls
let inventoryCache = null;
let inventoryCacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getCachedInventory() {
  const now = Date.now();
  if (inventoryCache && (now - inventoryCacheTime) < CACHE_TTL) {
    return inventoryCache;
  }
  const data = await getInventory();
  const summary = buildInventorySummary(data);
  inventoryCache = summary;
  inventoryCacheTime = now;
  return summary;
}

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
  const inventorySummary = await getCachedInventory();
  const systemPrompt = buildSystemPrompt(inventorySummary);

  const response = await axios.post(
    "https://api.anthropic.com/v1/messages",
    {
      model: "claude-sonnet-4-20250514",
      max_tokens: 500,
      system: systemPrompt,
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
    console.log("Webhook verified");
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

    const wantsAgent = /\bagente\b/i.test(userText) ||
      /hablar con (una )?persona/i.test(userText) ||
      /persona real/i.test(userText) ||
      /humano/i.test(userText);

    if (wantsAgent) {
      handedOffConversations.add(from);
      await sendWhatsAppMessage(from, "Claro que si! Te estoy conectando con *Bernhard Antony Perkins* ahora mismo. El te atendera en breve. Gracias por tu paciencia! 🙏");
      console.log(`Conversation ${from} handed off to human`);
      return;
    }

    if (handedOffConversations.has(from)) {
      console.log(`Conversation ${from} is with human - bot silent`);
      return;
    }

    const reply = await askClaude(from, userText);
    await sendWhatsAppMessage(from, reply + HANDOFF_FOOTER);
    console.log(`GangaBot replied to ${from}`);

  } catch (error) {
    console.error("Error:", error.response?.data || error.message);
  }
});

app.post("/reactivate", (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: "Phone required" });
  handedOffConversations.delete(phone);
  conversations.delete(phone);
  inventoryCache = null; // also refresh inventory
  console.log(`Bot reactivated for ${phone}`);
  res.json({ success: true, message: `Bot reactivated for ${phone}` });
});

app.get("/", (req, res) => {
  res.json({ status: "GangaBot is running!", store: "GangaLoo" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`GangaBot running on port ${PORT}`));
