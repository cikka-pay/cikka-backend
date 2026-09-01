import "dotenv/config";
import app from "./app";

const port = parseInt(process.env.PORT as string, 10) || 4000;

const server = app.listen(port, "0.0.0.0", () => {
  console.log(`Cikka dashboard API listening on port ${port}`);
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
