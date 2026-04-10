Making the server run 24/7

Recommended: PM2 (cross-platform Node process manager)

1) Install PM2 globally (requires admin/privilege):

```powershell
npm install -g pm2
```

2) From the `server` folder, start the server with the included ecosystem file:

```powershell
cd server
pm run pm2-start
```

3) Save process list and enable startup on boot:

```powershell
pm2 save
pm2 startup
# follow the printed command (run as admin) to configure startup
```

Windows alternative (NSSM):
- Install NSSM (https://nssm.cc/)
- Create a service that runs Node with `server.js` and set it to auto-restart.

Docker alternative:
- Build and run the app in a container and use a restart policy:

```powershell
# from workspace root
docker build -t chat-server ./server
docker run -d --restart unless-stopped -p 3000:3000 --name chat-server chat-server
```

Notes:
- PM2 handles automatic restarts on crashes and can be configured to run multiple instances.
- For production deployment, consider running this on a VPS, cloud VM, or container host and securing it behind a reverse proxy (nginx) with HTTPS.
