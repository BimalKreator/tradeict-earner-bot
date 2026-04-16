module.exports = {
  apps: [
    {
      name: "tradeict-web",
      script: "npm",
      args: "run start",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_restarts: 10,
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "tradeict-worker",
      script: "npm",
      args: "run trading:trend-arb-worker",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_restarts: 10,
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "tradeict-processor",
      script: "npm",
      args: "run trading:worker",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_restarts: 10,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};

