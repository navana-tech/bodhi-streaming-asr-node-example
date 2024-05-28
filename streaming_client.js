const WebSocket = require("websocket").w3cwebsocket;
const fs = require("fs");
const wavDecoder = require("wav-decoder");
const uuid = require("uuid");
const process = require("process");

// SSL context setup
const https = require("https");
https.globalAgent.options.rejectUnauthorized = false;

// Helper function for argument parsing
function intOrStr(text) {
  const num = parseInt(text, 10);
  return isNaN(num) ? text : num;
}

// Function to receive transcription from the server
async function receiveTranscription(ws) {
  let completeSentences = [];
  ws.onmessage = (message) => {
    let response;
    try {
      response = JSON.parse(message.data);
    } catch (error) {
      console.error(`Received a non-JSON response: ${message.data}`);
      return;
    }

    const callId = response.call_id;
    const segmentId = response.segment_id;
    const transcriptType = response.type;
    const transcriptText = response.text;
    const endOfStream = response.eos;

    if (transcriptType === "complete" && transcriptText !== "") {
      completeSentences.push(transcriptText);
    }

    console.log(
      `Received data: Call_id=${callId}, Segment_id=${segmentId}, EOS=${endOfStream}, Type=${transcriptType}, Text=${transcriptText}`
    );

    if (endOfStream) {
      console.log("Complete transcript: ", completeSentences.join(", "));
    }
  };
}

// Function to send audio data to the server
async function sendAudio(ws, audioBuffer, sampleRate, chunkDurationMs) {
  const bufferSize = Math.floor((sampleRate * chunkDurationMs) / 1000);
  const intervalSeconds = chunkDurationMs / 1000.0;
  let offset = 0;

  while (offset < audioBuffer.length) {
    if (ws.readyState === WebSocket.OPEN) {
      const endOffset = offset + bufferSize;
      const chunk = audioBuffer.slice(offset, endOffset);
      ws.send(chunk);
      offset = endOffset;
      await new Promise((res) => setTimeout(res, intervalSeconds * 1000));
    } else {
      console.error(
        "WebSocket connection is not open. Stopping audio sending."
      );
      break;
    }
  }

  if (ws.readyState === WebSocket.OPEN) {
    ws.send('{"eof": 1}');
  }
}

// Function to run the test
async function runTest(apiKey, customerId, uri, filePath) {
  const requestHeaders = {
    "x-api-key": apiKey,
    "x-customer-id": customerId,
  };
  const chunkDurationMs = 100;

  const ws = new WebSocket(uri, null, null, requestHeaders, null, {
    rejectUnauthorized: false,
  });

  ws.onopen = async () => {
    console.log("WebSocket connection opened.");
    const audioData = fs.readFileSync(filePath);
    let decoded;
    try {
      decoded = await wavDecoder.decode(audioData);
    } catch (err) {
      console.error("Error decoding WAV file:", err.message);
      ws.close();
      return;
    }

    const { sampleRate, channelData } = decoded;
    const audioBuffer = convertToPCM16(channelData);
    console.error(
      `Channels = ${channelData.length}, Sample Rate = ${sampleRate} Hz, Sample width = 2 bytes`
    );

    // Sending initial configuration to the server
    ws.send(
      JSON.stringify({
        config: {
          sample_rate: sampleRate,
          transaction_id: uuid.v4(),
          model: "hi-general-v2-8khz",
        },
      })
    );

    await Promise.all([
      sendAudio(ws, audioBuffer, sampleRate, chunkDurationMs),
      receiveTranscription(ws),
    ]);
  };

  ws.onerror = (error) => {
    console.error("WebSocket error:", error.message);
  };

  ws.onclose = () => {
    console.log("WebSocket connection closed");
  };
}

// Convert the decoded channel data to PCM 16-bit format
function convertToPCM16(channelData) {
  const interleaved = interleave(channelData);
  const buffer = new Int16Array(interleaved.length);
  for (let i = 0; i < interleaved.length; i++) {
    buffer[i] = Math.max(-1, Math.min(1, interleaved[i])) * 32767; // Convert float to PCM 16-bit
  }
  return Buffer.from(buffer.buffer);
}

// Interleave multi-channel audio data
function interleave(channelData) {
  if (channelData.length === 1) {
    return channelData[0];
  }

  const length = channelData[0].length + channelData[1].length;
  const result = new Float32Array(length);

  let inputIndex = 0;

  for (let i = 0; i < channelData[0].length; i++) {
    result[inputIndex++] = channelData[0][i];
    result[inputIndex++] = channelData[1][i];
  }
  return result;
}

// Main function
(async () => {
  const apiKey = process.env.API_KEY;
  const customerId = process.env.CUSTOMER_ID;

  if (!apiKey || !customerId) {
    console.error(
      "Please set API key and customer ID in environment variables."
    );
    return;
  }

  const args = process.argv.slice(2);
  const uri = args.includes("-u")
    ? args[args.indexOf("-u") + 1]
    : "wss://bodhi.navana.ai";
  const filePath = args.includes("-f") ? args[args.indexOf("-f") + 1] : null;

  if (filePath) {
    await runTest(apiKey, customerId, uri, filePath);
  } else {
    console.log(
      "This script is meant to show how to connect to Navana Streaming Speech Recognition API endpoint through websockets"
    );
    console.log(
      "Please pass the file path as an argument to stream a prerecorded audio file"
    );
    console.log("How to run the script:");
    console.log("node streaming_client.js -f streaming_demo.wav");
  }
})();
