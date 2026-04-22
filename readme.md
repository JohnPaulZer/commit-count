# GitHub Commit Counter

## Purpose

This app counts how many commits a GitHub user made:

- in one repository
- or across the repositories they own

Public repositories work without a token.
Private repositories need a classic GitHub token pasted into the app.

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
6. Optional: enter a repository if you want one repo only.
7. If you need private repo access, create a classic token:
   - Open [https://github.com/settings/tokens/new](https://github.com/settings/tokens/new)
   - Click `Generate new token (classic)`
   - Enter a name and expiration date
   - In `Scopes`, check `repo`
   - Click `Generate token`
   - Copy the token and paste it into the app
8. Click `Count commits`.

## Notes

- The repository field supports `repo-name`, `owner/repo`, `https://github.com/owner/repo`, and `git@github.com:owner/repo.git`
- GitHub must match the commit author to the username you enter
- Organization repositories may still require SSO or organization approval
