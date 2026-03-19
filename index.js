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
  descripcion: "Tienda especializada en cabello humano, pelucas y accesorios de belleza. Tambien hacemos compras por encargo desde Shein, Temu, Amazon y AliExpress.",
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
    "Cabellos 9A",
    "Cabellos 12A",
    "Cabellos 8A",
    "Pelucas Lacio",
    "Pelucas Ondulado",
    "Pelucas Rizado",
    "Pelucas Sinteticos",
    "Frontales",
    "Accesorios para Pelucas",
    "Accesorios de Belleza",
    "Salud y Bienestar",
  ],
  servicio_encargo: {
    descripcion: "Compramos por ti desde Shein, Temu, Amazon y AliExpress. Tu nos mandas el carrito y nosotros hacemos el pedido.",
    plataformas: ["Shein", "Temu", "Amazon", "AliExpress"],
    cotizador: "El cliente puede calcular el costo total de su pedido en: https://gangaloo.netlify.app/cotizador-gangaloo — solo ingresa el precio del carrito y el cotizador muestra lo que tiene que pagar.",
    opciones_pago_encargo: [
      "100% upfront (pago completo por adelantado)",
      "50% upfront + 50% al recibir el pedido"
    ],
    como_ordenar: "El cliente nos manda el link o screenshot de su carrito por WhatsApp. Nosotros calculamos el costo y confirmamos el pedido.",
    como_pagar: [
      "Efectivo en persona en nuestra sucursal de Maranata (Sosua)",
      "Transferencia bancaria (Banreservas, BHD, Popular)"
    ],
  },
  pagos_tienda: ["Efectivo", "Transferencia bancaria (Banreservas, BHD, Popular)", "Tarjeta de credito/debito", "PayPal"],
  delivery: "Enviamos a toda la Republica Dominicana. Pedidos locales: 24-48h. Interior del pais: 3-5 dias laborables.",
  redes: "Facebook: GangaLoo | Instagram: @GangaLoo | TikTok: @GangaLoo | YouTube: GangaLoo",
};

const SYSTEM_PROMPT = `Eres GangaBot, el asistente de WhatsApp de GangaLoo - una tienda especializada en cabello humano, pelucas, accesorios de belleza, y servicio de compras por encargo desde Shein, Temu, Amazon y AliExpress. Tenemos sucursales en Montellano y Sosua/Maranata, Republica Dominicana.

Personalidad: casual, amigable, dominicana. Habla como una experta. Usa expresiones como "Claro que si!", "Con gusto!", "Tenemos justo lo que buscas!". Emojis moderados (1-2 por mensaje). Responde SIEMPRE en espanol. Maximo 6 lineas. Directa y util.

INFORMACION COMPLETA:
${JSON.stringify(STORE_INFO, null, 2)}

REGLAS POR TEMA:

PRODUCTOS DE LA TIENDA (cabello, pelucas):
- Menciona las categorias relevantes y SIEMPRE manda: https://gangaloo.netlify.app/store
- Grados: 8A = buena calidad, 9A = mejor calidad, 12A = la mejor calidad y mas duradera.
- Pelucas: Lacio, Ondulado, Rizado y Sinteticos.

PEDIDOS POR ENCARGO (Shein, Temu, Amazon, AliExpress):
- Cuando alguien mencione Shein, Temu, Amazon, AliExpress, o quiera pedir algo de internet → explicar el servicio.
- SIEMPRE mandar el cotizador: https://gangaloo.netlify.app/cotizador-gangaloo
- Explicar que en el cotizador solo ingresa el precio del carrito y ve cuanto paga.
- Dos opciones de pago: 100% adelantado O 50% ahora + 50% al recibir.
- Para ordenar: el cliente nos manda el link o screenshot del carrito por WhatsApp.
- Pago del encargo: efectivo en Maranata (Sosua) O transferencia bancaria.
- Flujo ideal: "1) Calcula tu costo en el cotizador 2) Mandanos tu carrito por aqui 3) Confirmas el pago y hacemos el pedido!"

HORARIOS: da info de ambas sucursales.
PAGOS TIENDA: lista todos los metodos.
ENVIOS: explica brevemente.
PRECIOS: nunca inventes precios especificos.
SIN RESPUESTA: "Te conecto con un agente ahora mismo"
SIEMPRE termina con una pregunta o invitacion a continuar.`;

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
      await sendWhatsAppMessage(from, "Hola! Solo puedo leer mensajes de texto por ahora. En que te puedo ayudar?");
      return;
    }

    const userText = message.text.body;
    console.log(`Message from ${from}: ${userText}`);

    const reply = await askClaude(from, userText);
    console.log(`GangaBot reply: ${reply}`);

    await sendWhatsAppMessage(from, reply);

  } catch (error) {
    console.error("Error:", error.response?.data || error.message);
  }
});

app.get("/", (req, res) => {
  res.json({ status: "GangaBot is running!", store: "GangaLoo" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`GangaBot running on port ${PORT}`));
