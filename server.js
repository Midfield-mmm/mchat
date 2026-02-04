const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
    cors: { origin: "*", methods: ["GET", "POST"] },
    pingInterval: 10000,
    pingTimeout: 5000
});

app.use(cors());
app.use(express.static('public'));
app.use(express.json());

// Stockage en mémoire (à remplacer par une DB en production)
let users = {}; // mAddress => { socketId, friends: [mAddress], displayName, isOnline }
let messages = {}; // mAddress1_mAddress2 => [{from, text, timestamp}]

io.on('connection', socket => {
    console.log(`[Socket] Nouvelle connexion: ${socket.id}`);

    // ========== AUTHENTIFICATION ==========
    socket.on('login', ({ mAddress, displayName, firstName, lastName }) => {
        console.log(`[Login] ${mAddress} connecté`);
        
        users[mAddress] = { 
            socketId: socket.id, 
            displayName, 
            firstName,
            lastName,
            friends: [],
            isOnline: true,
            lastSeen: new Date()
        };
        
        socket.data.mAddress = mAddress;
        socket.data.displayName = displayName;

        // Envoyer la liste des utilisateurs connectés (sauf lui-même)
        const onlineUsers = Object.entries(users)
            .filter(([key]) => key !== mAddress)
            .map(([key, val]) => ({ 
                mAddress: key, 
                displayName: val.displayName,
                isOnline: true
            }));
        
        socket.emit('online-users', onlineUsers);
        socket.broadcast.emit('user-online', { 
            mAddress, 
            displayName,
            isOnline: true 
        });
    });

    // ========== GESTION DES AMIS ==========
    socket.on('add-friend', ({ friendAddress }) => {
        const userMAddress = socket.data.mAddress;
        
        if (users[friendAddress] && friendAddress !== userMAddress) {
            if (!users[userMAddress].friends.includes(friendAddress)) {
                users[userMAddress].friends.push(friendAddress);
                console.log(`[Friend] ${userMAddress} a ajouté ${friendAddress}`);
            }
            
            socket.emit('friend-added', { 
                mAddress: friendAddress, 
                displayName: users[friendAddress].displayName,
                isOnline: users[friendAddress].isOnline
            });
        } else {
            socket.emit('friend-not-found', { mAddress: friendAddress });
        }
    });

    socket.on('get-friends', () => {
        const userMAddress = socket.data.mAddress;
        const friendsList = users[userMAddress].friends.map(friendAddr => ({
            mAddress: friendAddr,
            displayName: users[friendAddr]?.displayName || friendAddr,
            isOnline: users[friendAddr]?.isOnline || false
        }));
        socket.emit('friends-list', friendsList);
    });

    // ========== MESSAGERIE ==========
    socket.on('message', ({ to, text }) => {
        const from = socket.data.mAddress;
        const timestamp = new Date().toISOString();
        const key = [from, to].sort().join('_');

        if (!messages[key]) messages[key] = [];
        messages[key].push({ from, text, timestamp });

        console.log(`[Message] ${from} -> ${to}: ${text}`);

        // Envoyer au destinataire s'il est connecté
        if (users[to]) {
            io.to(users[to].socketId).emit('message', { 
                from, 
                text, 
                timestamp,
                displayName: socket.data.displayName
            });
        }

        // Confirmation au sender
        socket.emit('message-sent', { to, text, timestamp });
    });

    socket.on('get-conversation', ({ with: friendAddress }) => {
        const userMAddress = socket.data.mAddress;
        const key = [userMAddress, friendAddress].sort().join('_');
        const conv = messages[key] || [];
        socket.emit('conversation', { with: friendAddress, messages: conv });
    });

    // ========== WEBRTC SIGNALING ==========
    socket.on('call-request', ({ to }) => {
        const from = socket.data.mAddress;
        console.log(`[Call] ${from} appelle ${to}`);
        
        if (users[to]) {
            io.to(users[to].socketId).emit('incoming-call', { 
                from,
                displayName: socket.data.displayName
            });
        } else {
            socket.emit('call-failed', { reason: 'User offline' });
        }
    });

    socket.on('call-accept', ({ from }) => {
        const to = socket.data.mAddress;
        console.log(`[Call] ${to} a accepté l'appel de ${from}`);
        
        if (users[from]) {
            io.to(users[from].socketId).emit('call-accepted', { to });
        }
    });

    socket.on('call-reject', ({ from }) => {
        const to = socket.data.mAddress;
        console.log(`[Call] ${to} a refusé l'appel de ${from}`);
        
        if (users[from]) {
            io.to(users[from].socketId).emit('call-rejected', { to });
        }
    });

    socket.on('webrtc-signal', ({ to, data }) => {
        console.log(`[WebRTC] Signal type: ${data.type} de ${socket.data.mAddress} à ${to}`);
        
        if (users[to]) {
            io.to(users[to].socketId).emit('webrtc-signal', { 
                from: socket.data.mAddress, 
                data 
            });
        }
    });

    socket.on('call-end', ({ to }) => {
        console.log(`[Call End] ${socket.data.mAddress} termine l'appel avec ${to}`);
        
        if (users[to]) {
            io.to(users[to].socketId).emit('call-ended', {
                from: socket.data.mAddress
            });
        }
    });

    // ========== DÉCONNEXION ==========
    socket.on('disconnect', () => {
        const mAddress = socket.data.mAddress;
        if (mAddress && users[mAddress]) {
            delete users[mAddress];
            console.log(`[Disconnect] ${mAddress} déconnecté`);
            io.emit('user-offline', mAddress);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Signaling server démarré sur http://localhost:${PORT}`);
});