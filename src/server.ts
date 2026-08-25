import "dotenv/config";
import app from "./app";

const port = parseInt(process.env.PORT as string, 10) || 4000;

app.listen(port, "0.0.0.0", () => {
  console.log(`Cikka dashboard API listening on port ${port}`);
});
