import { poll } from "./index";
import { closeDb } from "../db";

try {
  await poll();
} finally {
  closeDb();
}
