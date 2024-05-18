const WebSocket = require('websocket').w3cwebsocket;
const { spawn } = require('child_process');
const wavDecoder = require('wav-decoder');
const uuid = require('uuid');
const process = require('process');

// SSL context setup
const https = require('https');
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

        console.log(`Received data: Call_id=${callId}, Segment_id=${segmentId}, EOS=${endOfStream}, Type=${transcriptType}, Text=${transcriptText}`);

        if (endOfStream) {
            console.log("Complete transcript: ", completeSentences.join(", "));
        }
    };
}

// Function to send audio data to the server
async function sendAudio(ws, soxProcess, sampleRate, chunkDurationMs) {
    const bufferSize = Math.floor(sampleRate * chunkDurationMs / 1000);
    const intervalSeconds = chunkDurationMs / 1000.0;

    soxProcess.stdout.on('data', (data) => {
        ws.send(data);
    });

    soxProcess.stdout.on('end', () => {
        ws.send('{"eof": 1}');
    });
}

// Function to run the test
async function runTest(apiKey, customerId, uri) {
    const requestHeaders = {
        'x-api-key': apiKey,
        'x-customer-id': customerId,
    };
    const chunkDurationMs = 100;
    const sampleRate = 8000; // Assuming an 8kHz sample rate; adjust as needed

    const ws = new WebSocket(uri, null, null, requestHeaders, null, {
        rejectUnauthorized: false,
    });

    ws.onopen = async () => {
        const soxProcess = spawn('sox', ['-d', '-c', '1', '-r', sampleRate.toString(), '-t', 'wav', '-']);

        console.error(`Starting sox process: sox -d -c 1 -r ${sampleRate} -t wav -`);

        // Sending initial configuration to the server
        ws.send(JSON.stringify({
            config: {
                sample_rate: sampleRate,
                transaction_id: uuid.v4(),
                model: 'hi-general-feb24-v1-8khz',
            }
        }));

        await Promise.all([
            sendAudio(ws, soxProcess, sampleRate, chunkDurationMs),
            receiveTranscription(ws),
        ]);
    };

    ws.onclose = () => {
        console.log('Connection closed');
    };
}

// Main function
(async () => {
    const apiKey = process.env.API_KEY;
    const customerId = process.env.CUSTOMER_ID;

    if (!apiKey || !customerId) {
        console.error('Please set API key and customer ID in environment variables.');
        return;
    }

    const args = process.argv.slice(2);
    const uri = args.includes('-u') ? args[args.indexOf('-u') + 1] : 'wss://bodhi.navana.ai';

    await runTest(apiKey, customerId, uri);

    console.log("This script is meant to show how to connect to Navana Streaming Speech Recognition API endpoint through websockets");
    console.log("Ensure you have sox installed and configured to capture live audio input.");
})();
