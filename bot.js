const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const dayjs = require('dayjs');
const fs = require('fs');
const path = require('path');

const config = require('./config.json');

const TAUTULLI_URL = config.TAUTULLI_URL;
const TAUTULLI_API_KEY = config.TAUTULLI_API_KEY;
const DISCORD_BOT_TOKEN = config.DISCORD_BOT_TOKEN;
const DISCORD_CHANNEL_ID = config.DISCORD_CHANNEL_ID;
const REFRESH_TIME = config.REFRESH_TIME;

const LAST_MESSAGE_FILE = path.join(__dirname, 'lastMessageId.txt');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
let lastMessageId = null;
if (fs.existsSync(LAST_MESSAGE_FILE)) {
    lastMessageId = fs.readFileSync(LAST_MESSAGE_FILE, 'utf8');
}

function saveLastMessageId(messageId) {
    fs.writeFileSync(LAST_MESSAGE_FILE, messageId, 'utf8');
}

async function fetchStreamingData() {
    try {
        const response = await axios.get(`${TAUTULLI_URL}/api/v2`, {
            params: {
                apikey: TAUTULLI_API_KEY,
                cmd: 'get_activity'
            }
        });

        if (response.data && response.data.response && response.data.response.data && response.data.response.data.sessions) {
            return response.data.response.data.sessions;
        } else {
            console.error('Unexpected response format:', response.data);
            return [];
        }
    } catch (error) {
        console.error('Error fetching streaming data:', error.message);
        return [];
    }
}

function createProgressBar(current, total, length = 20) {
    const progress = Math.round((current / total) * length);
    const bar = '█'.repeat(progress) + '░'.repeat(length - progress);
    return `[${bar}]`;
}

function formatImdbLink(imdbId, title) {
    return imdbId ? `[${title}](<https://www.imdb.com/title/${imdbId}/>)` : title;
}

function extractImdbId(guid, guids) {
    let match = guid?.match(/imdb:\/\/tt(\d+)/);
    if (!match && Array.isArray(guids)) {
        for (const g of guids) {
            match = g.match(/imdb:\/\/tt(\d+)/);
            if (match) break;
        }
    }
    return match ? `tt${match[1]}` : null;
}

function createProgressBar(current, total, state, length = 20) {
    const progress = Math.round((current / total) * length);
    const bar = '█'.repeat(progress) + '░'.repeat(length - progress);
    const currentTime = formatTime(current);
    const totalTime = formatTime(total);

    return `[${bar}] (${currentTime} / ${totalTime})`;
}

function formatTime(milliseconds) {
    const totalSeconds = Math.floor(milliseconds / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return hours > 0
        ? `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
        : `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function getAggregateStats(sessions) {
    let totalBitrate = +0;
    let totalStreams = +0;
    let transcodingCount = +0;
    let localBitrate = +0;

    sessions.forEach(session => {
        totalStreams++;
        if (session.local == 0 && session.stream_bitrate) totalBitrate += Number(session.stream_bitrate);
        if (session.transcode_decision !== 'direct play') transcodingCount++;
        if (session.local == 1 && session.stream_bitrate) localBitrate += Number(session.stream_bitrate);
    });

    const totalBitrateFormatted =
        totalBitrate > 1000
            ? `${(totalBitrate / 1000).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} Mbps`
            : `${totalBitrate} kbps`;

    const localBitrateFormatted =
        localBitrate > 1000
            ? `${(localBitrate / 1000).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} Mbps`
            : `${localBitrate} kbps`;

    return `\n\n📊 **Stats:** ${totalStreams} streaming (${transcodingCount} transcoding) @ 📶 ${totalBitrateFormatted} (🏠 ${localBitrateFormatted} local)`;
}

function formatStreamingData(sessions) {
    if (sessions.length === 0) return '🎬 **No users are currently streaming on Plex.**';

    const timeUpdated = `🕒 **Last Updated:** ${dayjs().format('HH:mm:ss')} \n\n`;

    const sessionDetails = sessions.map(session => {
		//console.log(session);
        const imdbId = extractImdbId(session.guid, session.guids);
        const imdbLink = formatImdbLink(imdbId, session.full_title);
        const emojis = session.media_type === 'movie' ? '🎥' :
            session.media_type === 'track' ? '🎵' : '📺';		
		const watchingStr = session.state === 'paused' ? 'has paused' : session.media_type === 'track' ? 'is listening to' : 'is watching';
		const episode = session.media_type === 'episode' ? `S${String(session.parent_media_index).padStart(2, '0')} E${String(session.media_index).padStart(2, '0')}` : '';
		
        const progressBar = session.view_offset && session.duration
            ? `\n⏱️ ${createProgressBar(session.view_offset, session.duration, session.state)}`
            : '';

        const quality = session.stream_video_full_resolution
            ? session.video_full_resolution !== session.stream_video_full_resolution
                ? `${session.video_full_resolution} -> ${session.stream_video_full_resolution}`
                : `${session.stream_video_full_resolution}`
            : '';
			
		const bitrate = session.stream_bitrate
			? session.stream_bitrate > 1000
				? `\n🛜 ${quality} (${(session.stream_bitrate / 1000).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} Mbps)`
				: `\n🛜 ${quality} (${session.stream_bitrate.toLocaleString()} kbps)`
			: '';
        //const player = session.player ? `\n🖥️ Player: ${session.player}` : '';
        const transcoding = session.transcode_decision === 'direct play' ? ' ✅ Direct Play' : ' 🔄 Transcoding';
        return `${emojis} **${session.friendly_name}** ${watchingStr} **${imdbLink}** ${episode} (${session.year || 'N/A'})${progressBar}${bitrate}${transcoding}`;
    }).join('\n\n');

    const stats = getAggregateStats(sessions);

    return `${timeUpdated}${sessionDetails}${stats}`;
}

function waitForInterval(ms) {
    return new Promise(resolve => setInterval(resolve, ms));
}

async function updateDiscordChannel() {
    const channel = await client.channels.fetch(DISCORD_CHANNEL_ID);

    if (!channel) {
        console.error('Channel not found. Ensure the DISCORD_CHANNEL_ID is correct.');
        return;
    }

    try {
        const sessions = await fetchStreamingData();
        const messageContent = formatStreamingData(sessions);

        const messages = await channel.messages.fetch({ limit: 1 });
        const lastMessage = messages.first();

        if (lastMessage && lastMessage.id === lastMessageId && lastMessage.author.id === client.user.id) {
            await lastMessage.edit(messageContent);
        } else {
            if (lastMessageId) {
                const oldMessage = await channel.messages.fetch(lastMessageId).catch(() => null);
                if (oldMessage) await oldMessage.delete();
            }
            const newMessage = await channel.send(messageContent);
            lastMessageId = newMessage.id;
            saveLastMessageId(lastMessageId);
        }
    } catch (error) {
        console.error('Error updating Discord channel:', error.message);
    }
}

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);
    while (true) {
        await updateDiscordChannel();
        await waitForInterval(REFRESH_TIME);
    }
});

client.login(DISCORD_BOT_TOKEN);
