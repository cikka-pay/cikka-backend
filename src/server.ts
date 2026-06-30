import "dotenv/config";
import app from "./app";

const port = process.env.PORT || 4000;

app.listen(port, () => {
  console.log(`Cikka dashboard API listening on http://localhost:${port}`);
});
