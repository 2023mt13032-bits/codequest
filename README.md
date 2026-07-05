# AssessHub — self-hosted assessment platform

A HackerRank-style platform for running tests with your students. Supports:

- **Python coding questions** — Monaco editor, admin-defined test cases (visible + hidden), sandboxed execution with time/memory limits, per-test-case marks.
- **SQL (PostgreSQL) questions** — throwaway sandbox schema per run, seed data you define, graded by comparing against your correct query. Order-sensitive toggle. Read-only enforcement.
- **MCQ single / MCQ multiple** (with optional partial marking), **fill-in-the-blanks** (multiple accepted answers, case-sensitivity toggle), **descriptive** (manually graded by you).
- **Fully flexible timing** — optional open/close window, optional duration countdown, or completely unrestricted. Timing is server-side; students can't cheat by changing their clock.
- **Full admin control** — see every response, override any score, force-submit / reopen / reset attempts, live monitoring, CSV export.
- Students log in only with credentials you create. Answers auto-save; refresh/disconnect loses nothing.

Default logins after first start: admin = from your `.env` (defaults `admin` / `admin123`), plus a sample student `demo_student` / `demo123` and a sample assessment covering every question type.

---

## Part 1 — Test it in GitHub Codespaces (simple steps)

1. Push this whole folder to a GitHub repository (private is fine).
2. On the repo page, click the green **Code** button → **Codespaces** tab → **Create codespace on main**. Wait for it to open (it's a VS Code in the browser).
3. In the terminal at the bottom, type:
   ```bash
   docker compose up -d --build
   ```
   The first build takes 3–6 minutes. Wait until it finishes.
4. Codespaces will pop up a message saying port **80** is available. Click **Open in Browser**. (If you miss it: click the **Ports** tab next to the terminal, find port 80, click the globe icon.)
5. Log in with **admin / admin123**. You'll see the sample assessment.
6. To test as a student: open a **private/incognito browser window**, open the same URL, and log in as **demo_student / demo123**. Take the sample assessment — run the Python question, the SQL question, submit, then check the admin's Results screen in your first window.
7. When you're done testing:
   ```bash
   docker compose down
   ```
   Then stop or delete the codespace (Codespaces page on GitHub → "…" → Delete) so it doesn't eat your free hours.

If you change any code, rebuild with `docker compose up -d --build` again.

---

## Part 2 — Deploy on DigitalOcean (simple steps)

1. **Create the droplet**: DigitalOcean → Create → Droplets → Ubuntu 24.04 → Basic plan → Regular **4 GB RAM / 2 vCPU** ($24/month ≈ $16 for 20 days). Choose a datacenter near you (Bangalore). Add your SSH key or a root password. Create.
2. **Copy the project to the droplet.** Easiest way — from your computer (or Codespace) run:
   ```bash
   scp -r assesshub root@YOUR_DROPLET_IP:/root/
   ```
   (Or push to GitHub and `git clone` it on the droplet.)
3. **SSH in and deploy:**
   ```bash
   ssh root@YOUR_DROPLET_IP
   cd assesshub
   bash deploy.sh        # first run: installs Docker, creates .env, then asks you to set the admin password
   nano .env             # change ADMIN_PASSWORD (and ADMIN_USERNAME if you like), save with Ctrl+O, exit Ctrl+X
   bash deploy.sh        # second run: builds and starts everything
   ```
4. Open **http://YOUR_DROPLET_IP** in a browser. Log in as admin. Done.
5. **Give students the link and their credentials** (create them in the Students tab).

### Day-to-day admin tasks

- **Create students:** Students tab → type username + password → Create → share those with the student.
- **Create questions:** Questions tab → New question → pick the type. For Python, add test cases (tick "visible" for the ones students can see while solving; untick for hidden). For SQL, paste your seed SQL, paste YOUR correct query, and click **Preview expected result** to double-check before publishing.
- **Create an assessment:** Assessments tab → New assessment → add questions in order → set the time window (leave everything empty for no time restrictions) → tick **Published**.
- **Watch live / grade / override:** Assessments → Results / responses. It refreshes automatically. Click **View responses** to read a student's full code/answers, set manual scores (needed for descriptive questions), force-submit, reopen, or reset attempts. **Export CSV** for the final mark sheet.

### Backup (optional but smart)

```bash
docker compose exec db pg_dump -U app assesshub > backup_$(date +%F).sql
```
Download it with `scp root@YOUR_DROPLET_IP:/root/assesshub/backup_*.sql .`

### Tear everything down after 20 days

Just destroy the droplet from the DigitalOcean dashboard (Droplet → Destroy). Billing stops immediately. Nothing else to clean up.

---

## Notes on how it works (for reference)

- **Services** (docker-compose): `frontend` (React + nginx, the only exposed port), `backend` (FastAPI), `db` (app Postgres, persisted), `sqlsandbox` (separate Postgres for grading SQL — deliberately not persisted), `executor` (isolated Python runner, non-root, memory/CPU/process/output limits, max 4 concurrent runs).
- **Timing is server-authoritative**: deadline = earliest of (assessment close time, attempt start + duration). Expired attempts auto-submit with whatever was auto-saved.
- **Hidden test cases** never send their input/expected/output to the student's browser — students only see pass counts after submitting (if you enabled "show results").
- **SQL grading**: each run creates a throwaway schema, runs your seed SQL, runs your correct query for the expected result, runs the student query with a 10s timeout and a write-keyword block, compares column names + rows, then drops the schema.
- Design decisions made for simplicity: one attempt per student per assessment (use **Reset** to grant a retake); the Python sandbox uses process-level isolation inside a locked-down container rather than one container per run — fine for a trusted class of 4–5, not for hostile internet users.
