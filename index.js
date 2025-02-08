const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const fs = require("fs");
const FormData = require("form-data");
const { ytdown } = require("nayan-videos-downloader"); // YouTube downloader package
const config = require("./config.json");

const app = express();
const PORT = process.env.PORT || 3000;

// Record the start time for uptime calculation.
const startTime = Date.now();

app.use(bodyParser.json());

// (Optional) Serve index.html from the root directory if needed
// app.get('/', (req, res) => {
//   res.sendFile(__dirname + '/index.html');
// });

// ---------------------
// Helper Logging Functions
// ---------------------
function logShow(message) {
  console.log(`FnaF -Show: ${message}`);
}

function logError(message) {
  console.error(`FnaF -Show: ${message}`);
}

// ---------------------
// Helper Download Function
// ---------------------
async function downloadVideo(videoUrl, filePath) {
  try {
    // Include a custom User-Agent header to mimic a browser.
    const response = await axios.get(videoUrl, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/98.0.4758.102 Safari/537.36'
      }
    });
    fs.writeFileSync(filePath, response.data);
  } catch (error) {
    throw error;
  }
}

// ---------------------
// Helper Attachment Functions
// ---------------------
async function sendAudioAttachment(senderId, filePath, title) {
  const url = `https://graph.facebook.com/v18.0/me/messages?access_token=${config.PAGE_ACCESS_TOKEN}`;
  const form = new FormData();
  form.append("recipient", JSON.stringify({ id: senderId }));
  form.append("message", JSON.stringify({
    attachment: {
      type: "audio",
      payload: { is_reusable: true }
    }
  }));
  form.append("filedata", fs.createReadStream(filePath));
  try {
    await axios.post(url, form, { headers: form.getHeaders() });
    logShow(`Sent audio attachment to ${senderId}: ${title}`);
  } catch (error) {
    logError("Error sending audio attachment: " + (error.response ? error.response.data : error.message));
  }
}

async function sendVideoAttachment(senderId, filePath, title) {
  const url = `https://graph.facebook.com/v18.0/me/messages?access_token=${config.PAGE_ACCESS_TOKEN}`;
  const form = new FormData();
  form.append("recipient", JSON.stringify({ id: senderId }));
  form.append("message", JSON.stringify({
    attachment: {
      type: "video",
      payload: { is_reusable: true }
    }
  }));
  form.append("filedata", fs.createReadStream(filePath));
  try {
    await axios.post(url, form, { headers: form.getHeaders() });
    logShow(`Sent video attachment to ${senderId}: ${title}`);
  } catch (error) {
    logError("Error sending video attachment: " + (error.response ? error.response.data : error.message));
  }
}

// ---------------------
// Express Routes
// ---------------------

// (Optional) /stats endpoint to provide realtime status info.
app.get("/stats", (req, res) => {
  const uptimeMillis = Date.now() - startTime;
  const uptimeSeconds = Math.floor(uptimeMillis / 1000);
  res.json({
    profileName: config.adminName || "Unknown",
    uptimeSeconds: uptimeSeconds
  });
});

// Webhook Verification Endpoint
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === config.VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Webhook Event Listener for Messenger
app.post("/webhook", async (req, res) => {
  const body = req.body;
  if (body.object === "page") {
    body.entry.forEach(async (entry) => {
      const webhookEvent = entry.messaging[0];
      const senderId = webhookEvent.sender.id;

      // Process incoming text messages.
      if (webhookEvent.message && webhookEvent.message.text) {
        let userQuestion = webhookEvent.message.text.trim();
        let command = userQuestion.toLowerCase();

        // Log sender type.
        if (senderId === config.admin) {
          logShow(`Admin: ${userQuestion}`);
        } else {
          logShow(`User id: ${senderId}, User question: ${userQuestion}`);
        }

        // Process slash commands.
        if (userQuestion.startsWith("/")) {
          const parts = userQuestion.split(" ");
          const cmd = parts[0].toLowerCase();

          // /help command.
          if (cmd === "/help") {
            const helpMessage =
`Available commands:
/help - Show this help message
/ytdl <-v/-a> <YouTube URL> - Download a YouTube video as video (-v) or audio (-a)
/restart - Restart the bot (admin only)
/uptime - Show bot uptime (admin only)

For general queries, just type your message without a slash.
(Note: "/ai" and "/feddy" are not valid commands—they will be treated as normal queries.)`;
            await sendMessage(senderId, helpMessage);
            return;
          } else if (cmd === "/ytdl") {
            // Expected format: /ytdl <-v/-a> <YouTube URL>
            if (parts.length < 3) {
              await sendMessage(senderId, "Usage: /ytdl <-v/-a> <YouTube URL>");
              return;
            }
            const modeFlag = parts[1].toLowerCase();
            if (modeFlag !== "-v" && modeFlag !== "-a") {
              await sendMessage(senderId, "Usage: /ytdl <-v/-a> <YouTube URL>");
              return;
            }
            const url = parts.slice(2).join(" ").trim();
            if (!url.includes("youtube") && !url.includes("youtu.be")) {
              await sendMessage(senderId, "Invalid YouTube URL. Please provide a valid YouTube video link.");
              return;
            }
            try {
              // Use ytdown to get video data.
              // Expected output: { data: { title: <video title>, video: <URL to video file> } }
              const result = await ytdown(url);
              const videoData = result.data;

              // Send the video title first.
              await sendMessage(senderId, `▶️Title: ${videoData.title}`);

              // Ensure the cache folder exists.
              const cacheDir = "./cache";
              if (!fs.existsSync(cacheDir)) {
                fs.mkdirSync(cacheDir);
              }
              // Determine file path based on the mode flag.
              const filePath = modeFlag === "-v" ? `${cacheDir}/ytdl.mp4` : `${cacheDir}/ytdl.mp3`;

              // Download the video file.
              await downloadVideo(videoData.video, filePath);

              await sendMessage(senderId, "Done downloading. Sending " + (modeFlag === "-v" ? "video" : "audio") + "...");

              // Send the attachment.
              if (modeFlag === "-v") {
                await sendVideoAttachment(senderId, filePath, videoData.title);
              } else {
                await sendAudioAttachment(senderId, filePath, videoData.title);
              }

              // Delete the file after sending.
              fs.unlink(filePath, (err) => {
                if (err) {
                  sendMessage(senderId, "Error deleting file: " + (err.message || "Unknown error."));
                  logError("Error deleting file: " + (err.message || "Unknown error."));
                } else {
                  logShow("Deleted file: " + filePath);
                }
              });
            } catch (error) {
              const errorMessage = "Failed to download video: " + (error.message || "Unknown error.");
              await sendMessage(senderId, errorMessage);
              return;
            }
            return;
          } else if (senderId === config.admin && (cmd === "/restart" || cmd === "/uptime")) {
            if (cmd === "/restart") {
              await sendMessage(senderId, "Restarting bot...");
              logShow("Admin requested restart. Exiting process...");
              process.exit(0);
              return;
            } else if (cmd === "/uptime") {
              const now = Date.now();
              const uptimeMillis = now - startTime;
              const uptimeSeconds = Math.floor(uptimeMillis / 1000);
              const hours = Math.floor(uptimeSeconds / 3600);
              const minutes = Math.floor((uptimeSeconds % 3600) / 60);
              const seconds = uptimeSeconds % 60;
              const uptimeMessage = `Uptime: ${hours} hours, ${minutes} minutes, and ${seconds} seconds.`;
              await sendMessage(senderId, uptimeMessage);
              return;
            }
          } else if (cmd === "/ai" || cmd === "/feddy") {
            userQuestion = userQuestion.substring(1);
          } else {
            await sendMessage(senderId, "Invalid command, use /help to see it");
            return;
          }
        }

        // Process non-command (or modified) messages with the AI API.
        await sendSenderAction(senderId, "typing_on");
        const aiResponse = await getAIResponse(userQuestion);
        await sendSenderAction(senderId, "typing_off");
        await sendMessage(senderId, aiResponse);
      }

      // Handle Get Started Postback.
      if (webhookEvent.postback) {
        const payload = webhookEvent.postback.payload;
        if (payload === "GET_STARTED_PAYLOAD") {
          const welcomeMessage = "Welcome to [Your Page Name]! We're excited to have you here. How can we assist you today?";
          await sendMessage(senderId, welcomeMessage);
        }
      }
    });
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

// ---------------------
// AI API Call Function
// ---------------------
async function getAIResponse(question) {
  const systemPrompt = `
    You are Freddy—a charismatic and friendly performer from Five Nights at Freddy's.
    You are celebrated for composing original songs and entertaining families at Freddy's Pizza.
    Your history is filled with legendary performances and warm camaraderie with your friends Bonnie, Chica, and Foxy.
    When answering questions, respond in a warm, professional, and directly connected manner that addresses the user's query.
    Avoid overly poetic, archaic, or rhyming language. Always speak naturally, keeping your responses clear and relatable.
    Under no circumstances should you reveal that you are an AI, a language model, or any type of software.
    Remain in character as Freddy at all times.
  `;
  const fullPrompt = systemPrompt + "\n" + question;
  logShow("Full prompt sent to AI API: " + fullPrompt);
  const apiUrl = `https://ajiro.gleeze.com/api/gpt?q=${encodeURIComponent(fullPrompt)}`;
  try {
    const response = await axios.get(apiUrl);
    const answer = response.data.message || "No response from AI API.";
    return answer;
  } catch (error) {
    logError("Error fetching AI response: " + (error.response ? error.response.data : error.message));
    return "I'm sorry, I encountered an error processing your request.";
  }
}

// ---------------------
// Messenger API Helper Functions
// ---------------------
async function sendSenderAction(senderId, action) {
  const url = `https://graph.facebook.com/v18.0/me/messages?access_token=${config.PAGE_ACCESS_TOKEN}`;
  const payload = {
    recipient: { id: senderId },
    sender_action: action,
  };
  try {
    await axios.post(url, payload);
  } catch (error) {
    logError("Error sending sender action: " + (error.response ? error.response.data : error.message));
  }
}

async function sendMessage(senderId, text) {
  const url = `https://graph.facebook.com/v18.0/me/messages?access_token=${config.PAGE_ACCESS_TOKEN}`;
  const messageData = {
    recipient: { id: senderId },
    message: { text: text },
  };
  try {
    await axios.post(url, messageData);
    logShow(`Sent message to ${senderId}: ${text}`);
  } catch (error) {
    logError("Error sending message: " + (error.response ? error.response.data : error.message));
  }
}

// ---------------------
// Start the Server
// ---------------------
app.listen(PORT, () => {
  logShow(`Server running on port ${PORT}`);
  const startupMessage = "Bot online!\nMade by Mart John Labaco\nOwn code\nFbPageBot";
  sendMessage(config.admin, startupMessage).catch(err => logError(err));
});
