module.exports = {
  apps: [
    {
      name: 'vibe-server',
      script: 'server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000
    },
    {
      name: 'ngrok-tunnel',
      script: 'start-ngrok.bat',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      autorestart: true,
      max_restarts: 5,
      restart_delay: 10000
    }
  ]
};
