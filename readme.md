# GitHub Commit Counter

## Purpose

This app counts how many commits a GitHub user made:

- in one repository
- or across the repositories they own

Public repositories work without a token.
Private repositories need a classic GitHub token pasted into the app.
You can also set a classic token in `.env` with `GITHUB_TOKEN=...` so the backend can reuse it automatically.

## Live Link

https://gitcommitcount.vercel.app/

## Process

1. Copy `.env.example` to `.env`.
   
2. Install dependencies:

   ```bash
   npm install
   ```

3. Start the app:

   ```bash
   npm start
   ```

4. Open [http://localhost:3000](http://localhost:3000)
5. Enter the GitHub username.
6. Optional: enter one repository only.
   Use a GitHub repository URL in HTTPS or SSH format.
7. If you need private repo access, create a classic token:
   - Open [https://github.com/settings/tokens/new](https://github.com/settings/tokens/new)
   - Click `Generate new token (classic)`
   - Enter a name and expiration date
   - In `Scopes`, check `repo`
   - Click `Generate token`
   - Copy the token and paste it into the app
8. Click `Count commits`.

## Notes

- Repository URL examples: `https://github.com/owner/repo` or `git@github.com:owner/repo.git`
- GitHub must match the commit author to the username you enter
- Organization repositories may still require SSO or organization approval

## Screenshots
<img width="1665" height="959" alt="image" src="https://github.com/user-attachments/assets/9c91bb55-ce69-4d1c-990f-e98f81a38abd" />

<img width="1678" height="959" alt="image" src="https://github.com/user-attachments/assets/b01b58dc-740a-48aa-897f-465f709ca2a2" />
