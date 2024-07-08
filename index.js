import {
  makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  isJidUser,
  isJidGroup,
  fetchLatestWaWebVersion,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import pino from "pino";
import moment from "moment-timezone";
import { scheduleJob } from "node-schedule";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
moment.locale("id");
const handleText = (param1, param2, param3) => {
  const hour = new Date(handleGetDate()).getHours();
  const isBetween7AMand4PM = hour >= 7 && hour <= 16;
  return `🌶️ Risol Pedas: Rasakan sensasi pedas yang membangunkan selera dengan setiap gigitan. Cocok bagi pecinta pedas! 🌶️\n\n💰 Harga Spesial: ${param1} per porsi isi ${param2} risol kecil atau ${param3} risol besar. 💸`;
};
const handleGetDate = () => {
  return moment().tz("Asia/Jakarta").format("YYYY-MM-DD, HH:mm:ss");
};
const handleError = async (sock, context, error) => {
  sock
    ? await sock.sendMessage("6281283874976@s.whatsapp.net", {
        text: `${handleGetDate()} : ${context} : ${error.message}`,
      })
    : console.error(`${handleGetDate()} : ${context} : ${error.message}`);
};
const connectToWhatsApp = async () => {
  const { state, saveCreds } = await useMultiFileAuthState("session");
  const { version } = await fetchLatestWaWebVersion();
  const sock = makeWASocket({
    printQRInTerminal: true,
    auth: state,
    logger: pino({ level: "silent" }),
    version,
  });
  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === "close") {
      const reason = new Boom(lastDisconnect.error).output.statusCode;
      switch (reason) {
        case DisconnectReason.badSession:
          handleError(
            sock,
            "Bad Data File",
            new Error("Please Delete Database and Scan Again.")
          );
          sock.logout();
          break;
        case DisconnectReason.connectionClosed:
          handleError(sock, "Connection Closed", new Error("Reconnecting..."));
          connectToWhatsApp();
          break;
        case DisconnectReason.connectionLost:
          handleError(
            sock,
            "Connection Lost from Server",
            new Error("Reconnecting...")
          );
          connectToWhatsApp();
          break;
        case DisconnectReason.connectionReplaced:
          handleError(
            sock,
            "Connection Replaced",
            new Error(
              "Another New Session Opened, Please Close Current Session First.."
            )
          );
          sock.logout();
          break;
        case DisconnectReason.loggedOut:
          handleError(
            sock,
            "Device Logged Out",
            new Error("Please Delete Database and Scan Again.")
          );
          sock.logout();
          break;
        case DisconnectReason.restartRequired:
          handleError(sock, "Restart Required", new Error("Restarting..."));
          connectToWhatsApp();
          break;
        case DisconnectReason.timedOut:
          handleError(
            sock,
            "Connection Timed-Out",
            new Error("Reconnecting...")
          );
          connectToWhatsApp();
          break;
        default:
          sock.end(
            `${handleGetDate()} : Unknown Disconnect Reason: ${reason} | ${
              lastDisconnect.error
            }`
          );
          break;
      }
    } else if (connection === "connecting") {
      console.info(`${handleGetDate()} : Opening Connection...`);
    } else if (connection === "open") {
      console.info(`${handleGetDate()} : Opened Connection.`);
    }
  });
  sock.ev.on("creds.update", saveCreds);
  const sendMessageWithRetry = async (
    number,
    message,
    options,
    retries = 3
  ) => {
    for (let i = 0; i < retries; i++) {
      try {
        await sock.sendMessage(number, message, options);
        return;
      } catch (error) {
        if (i === retries - 1) {
          handleError(
            sock,
            `Failed to send message to ${number} after ${retries} attempts`,
            error
          );
        } else {
          console.warn(
            `${handleGetDate()} : Retrying to send message to ${number} (${
              i + 1
            }/${retries})`
          );
        }
      }
    }
  };
  const processGroupMessages = async (groupId, imageUrl, handleTextArgs) => {
    try {
      const groupMembers = await prisma.detailGroup.findMany({
        where: { group_id: groupId },
      });
      const productDetails = await prisma.detailProduct.findMany({
        where: { group_id: groupId },
      });
      const [price, quantity1, quantity2] = handleTextArgs(productDetails);
      for (const member of groupMembers) {
        await sendMessageWithRetry(
          member.number,
          {
            image: { url: imageUrl },
            caption: handleText(price, quantity1, quantity2),
          },
          {
            ephemeralExpiration: 86400,
          }
        );
      }
    } catch (error) {
      handleError(sock, "Process Group Messages", error);
    }
  };
  const mutiara = async () => {
    await processGroupMessages(1, "img/Risol-10k.png", (details) => [
      `${details[0].price}K`,
      details[0].quantity,
      details[1].quantity,
    ]);
  };
  const keraton = async () => {
    await processGroupMessages(2, "img/Risol-12k.png", (details) => [
      `${details[0].price}K`,
      details[0].quantity,
      details[1].quantity,
    ]);
  };
  const scheduleJobs = () => {
    scheduleJob({ rule: "0 0,20,40 * * * *" }, async () => {
      try {
        const status = await prisma.status.findMany();
        const hour = new Date(handleGetDate()).getHours();
        const isBetween7AMand9PM = hour >= 7 && hour <= 20;
        if (status[0].status && status[1].status && isBetween7AMand9PM) {
          await mutiara();
        }
      } catch (error) {
        handleError(sock, "Schedule Job Mutiara", error);
      }
    });
    scheduleJob({ rule: "0 0,15,30,45 * * * *" }, async () => {
      try {
        const status = await prisma.status.findMany();
        const hour = new Date(handleGetDate()).getHours();
        const isBetween7AMand9PM = hour >= 7 && hour <= 20;
        if (status[0].status && status[2].status && isBetween7AMand9PM) {
          await keraton();
        }
      } catch (error) {
        handleError(sock, "Schedule Job Keraton", error);
      }
    });
  };
  scheduleJobs();
  sock.ev.on("messages.upsert", async (message) => {
    if (message.type === "notify") {
      const msg = message.messages[0];
      const msgTime = handleGetDate();
      const numberSplit = msg.key.remoteJid.split("@");
      const number = numberSplit[0];
      if (isJidUser(msg.key.remoteJid) && !msg.key.fromMe) {
        console.info("\n==================MESSAGE==================");
        console.info(`|Name    : ${msg.pushName}`);
        console.info(`|Number  : ${msg.key.remoteJid}`);
        console.info(`|Time    : ${msgTime}`);
        console.info(
          `|Message : ${
            msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            ""
          }`
        );
        console.info("===========================================\n");
        try {
          const isCustomer = await prisma.customer.findUnique({
            where: {
              number: msg.key.remoteJid,
              AND: [
                {
                  created_at: {
                    gte: new Date(new Date(msgTime).setHours(0, 0, 0, 0)),
                  },
                },
                {
                  created_at: {
                    lte: new Date(new Date(msgTime).setHours(23, 59, 59, 999)),
                  },
                },
              ],
            },
          });
          const isAdmin = await prisma.admin.findUnique({
            where: { number: msg.key.remoteJid },
          });
          const status = await prisma.status.findUnique({ where: { id: 1 } });
          const hour = new Date(msgTime).getHours();
          const isBetween7AMand9PM = hour >= 7 && hour <= 20;
          if (
            status.status &&
            !isAdmin &&
            !isCustomer.length > 0 &&
            isBetween7AMand9PM
          ) {
            try {
              const ticket = `REC${Math.random()
                .toString(36)
                .substr(2, 3)
                .toUpperCase()}`;
              await prisma.customer.create({
                data: {
                  name: msg.pushName,
                  number: msg.key.remoteJid,
                  ticket,
                  created_at: new Date(msgTime).toISOString(),
                },
              });
              console.info(`${handleGetDate()} : Data Successfully Saved.`);
              await sock.sendMessage(msg.key.remoteJid, {
                text: `Hai kak ${msg.pushName}!\nID Pesanan : ${ticket}\nZona Waktu : ${msgTime}\nUntuk menunya ready ya kak!, Mau berapa porsi kak? Cantumin blok rumahnya juga ya kak! 😃`,
              });
              await sock.sendMessage(msg.key.remoteJid, {
                text: "Tersedia Juga :\n<———————————————————>\nNugget Champ Coin | 200gr : 18K\nNugget Salam             | 250gr : 13K\nNugget So Nice          | 250gr : 15K\nSosis Champ Kecil : \n- Isi 3    : 5K\n- Isi 24 : 25K\n<———————————————————>\nTerima Kasih🙏🏻",
              });
              await sock.sendMessage("6285693695566@s.whatsapp.net", {
                text: `Pesanan Baru Telah Masuk!\nNama Cust  : ${msg.pushName}\nID Pesanan  : ${ticket}\nZona Waktu : ${msgTime}\nNo Telepon  : ${number}`,
              });
            } catch (error) {
              handleError(sock, "Handle Customer", error);
            }
          } else if (isAdmin) {
            let result;
            switch (msg.message.conversation.toLowerCase()) {
              case "on":
                result = await prisma.status.update({
                  where: { id: 1 },
                  data: { status: true },
                });
                await sock.sendMessage(msg.key.remoteJid, {
                  text: `Status: ${result.status ? "On" : "Off"}`,
                });
                break;
              case "off":
                result = await prisma.status.update({
                  where: { id: 1 },
                  data: { status: false },
                });
                await sock.sendMessage(msg.key.remoteJid, {
                  text: `Status: ${result.status ? "On" : "Off"}`,
                });
                break;
              case "mutiara on":
                result = await prisma.status.update({
                  where: { id: 2 },
                  data: { status: true },
                });
                await sock.sendMessage(msg.key.remoteJid, {
                  text: `Status Mutiara: ${result.status ? "On" : "Off"}`,
                });
                break;
              case "mutiara off":
                result = await prisma.status.update({
                  where: { id: 2 },
                  data: { status: false },
                });
                await sock.sendMessage(msg.key.remoteJid, {
                  text: `Status Mutiara: ${result.status ? "On" : "Off"}`,
                });
                break;
              case "keraton on":
                result = await prisma.status.update({
                  where: { id: 3 },
                  data: { status: true },
                });
                await sock.sendMessage(msg.key.remoteJid, {
                  text: `Status Keraton: ${result.status ? "On" : "Off"}`,
                });
                break;
              case "keraton off":
                result = await prisma.status.update({
                  where: { id: 3 },
                  data: { status: false },
                });
                await sock.sendMessage(msg.key.remoteJid, {
                  text: `Status Keraton: ${result.status ? "On" : "Off"}`,
                });
                break;
              default:
                break;
            }
          }
        } catch (error) {
          handleError(sock, "Handle Customer", error);
        }
      } else if (isJidGroup(msg.key.remoteJid) && !msg.key.fromMe) {
        return;
      }
    }
  });
};
connectToWhatsApp().catch((error) => {
  handleError("Initial Connection", error);
});
