import { runSlaSweep } from "../src/server/sla"

runSlaSweep(null)
  .then((result) => {
    console.log(result.message)
    console.log(`Checked ${result.checked}. Escalated ${result.escalated}.`)
  })
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
