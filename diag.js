const db = require('./db');

async function diag() {
  try {
    const r1 = await db.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'messages'");
    console.log("MESSAGES TABLE COLUMNS:");
    console.log(r1.rows);

    const r2 = await db.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'chat_messages'");
    console.log("CHAT_MESSAGES TABLE COLUMNS:");
    console.log(r2.rows);

    const r3 = await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
    console.log("TABLES IN PUBLIC SCHEMA:");
    console.log(r3.rows);

  } catch(e) {
    console.error("DIAG ERROR:", e.message);
  }
  process.exit(0);
}

diag();
