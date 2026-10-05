import "dotenv/config";
import app from "./app";

const port = parseInt(process.env.PORT as string, 10) || 4000;

const server = app.listen(port, "0.0.0.0", () => {
  console.log(`\n==================================================`);
  console.log(`🚀 Cikka Backend API listening on port ${port}`);
  console.log(`   Local URL:    http://localhost:${port}`);
  console.log(`   Network URL:  http://192.168.31.141:${port}`);
  console.log(`   Health Check: http://localhost:${port}/health`);
  console.log(`==================================================`);
  console.log(`ℹ️  Backend is ready and waiting for frontend requests.`);
  console.log(`📱 To start the mobile app, open another terminal and run:\n   npm start\n`);
});


server.on("error", (err: any) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\n❌ Error: Port ${port} is already in use by another process.`);
    console.error(`👉 To free the port on Windows, run:\n   Stop-Process -Id (Get-NetTCPConnection -LocalPort ${port}).OwningProcess -Force\n`);
    process.exit(1);
  } else {
    throw err;
  }
});
