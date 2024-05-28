const WebSocket = require("websocket").w3cwebsocket;
const fs = require("fs");
const wav = require("node-wav");
const uuid = require("uuid");
const process = require("process");

// SSL context setup
const https = require("https");
https.globalAgent.options.rejectUnauthorized = false;

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
async function sendAudio(ws, audioData, sampleRate, chunkDurationMs) {
  const bufferSize = Math.floor((sampleRate * chunkDurationMs) / 1000);
  const intervalSeconds = chunkDurationMs / 1000.0;

  let offset = 0;
  while (offset < audioData.length) {
    const chunk = audioData.slice(offset, offset + bufferSize);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(chunk);
    } else {
      console.error(
        "WebSocket connection is not open. Stopping audio sending."
      );
      break;
    }
    offset += bufferSize;
    await new Promise((res) => setTimeout(res, intervalSeconds * 1000));
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

    // Read and decode the WAV file
    const audioBuffer = fs.readFileSync(filePath);
    const result = wav.decode(audioBuffer);

    if (!result) {
      console.error("Failed to decode WAV file.");
      ws.close();
      return;
    }

    const { sampleRate, channelData } = result;
    const audioData = new Int16Array(channelData[0].length);

    // Convert Float32Array to Int16Array
    for (let i = 0; i < channelData[0].length; i++) {
      audioData[i] = Math.max(-1, Math.min(1, channelData[0][i])) * 32767;
    }

    console.log(
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
      sendAudio(ws, audioData, sampleRate, chunkDurationMs),
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
    console.log("node streaming_client_with_conversion.js -f test.wav");
  }
})();
