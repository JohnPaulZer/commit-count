# GitHub Commit Counter

This app counts how many commits a GitHub user made in one repository, or across all repositories they own.

It works with public repositories by default, and it also works with private repositories when the backend has a valid GitHub token.

## Run the app

1. Copy `.env.example` to `.env`.
2. Add your GitHub token in `.env`:

   ```env
   PORT=3000
   GITHUB_TOKEN=your_token_here
   ```

3. Install dependencies:

   ```bash
   npm install
   ```

4. Start the app:

   ```bash
   npm start
   ```

5. Open the app in your browser:

   [Open the app](http://localhost:3000)

## Project structure

```text
count/
|-- public/
|   |-- index.html
|   `-- assets/
|       |-- css/
|       |   `-- styles.css
|       |-- js/
|       |   `-- app.js
|       `-- lottie/
|           `-- loading.lottie
|-- src/
|   `-- server.js
|-- .env.example
|-- package.json
`-- README.md
```

## How to use

1. Enter the GitHub username.
2. Leave the repository field blank if you want to count commits across all repositories owned by that user.
3. If you want to count one repository only, enter one of these:
   - `repo-name`
   - `owner/repo`
   - `https://github.com/owner/repo`
   - `git@github.com:owner/repo.git`
4. Click `Count commits`.

## How to get a token

Open the GitHub token page:

[https://github.com/settings/personal-access-tokens](https://github.com/settings/personal-access-tokens)

GitHub supports two token types:

- Fine-grained token
- Personal access token (classic)

### Fine-grained token

Use this when:

- you want access only to specific repositories
- the repository is your own
- or the organization allows fine-grained tokens

Steps:

1. Go to `Settings`.
2. Open `Developer settings`.
3. Open `Personal access tokens`.
4. Click `Fine-grained tokens`.
5. Click `Generate new token`.
6. Set a token name and expiration.
7. Choose the correct `Resource owner`.
8. Choose `Only select repositories` and pick the repository you need.
9. Give it repository read access.
10. Generate the token and copy it immediately.

### Classic token

Use this when:

- you are an outside collaborator or invited collaborator on someone else's organization repository
- a fine-grained token does not work for that org repo

Steps:

1. Go to `Settings`.
2. Open `Developer settings`.
3. Open `Personal access tokens`.
4. Click `Tokens (classic)`.
5. Click `Generate new token (classic)`.
6. Set a name and expiration.
7. Enable the `repo` scope.
8. Generate the token and copy it immediately.

### Important token notes

- GitHub only shows the full token once after creation.
- If the repository belongs to an organization, the org may block certain token types.
- Some organizations require token approval before the token can access private repositories.
- If the org uses SSO, you may need to authorize the token for that organization.

## What happens without a repository

If you only enter a username:

- the app scans repositories owned by that username
- public owned repositories are included by default
- owned private repositories are included too when the backend token belongs to that same GitHub account and has access

## Notes

- Organization repositories are supported.
- Private repositories require `GITHUB_TOKEN` on the backend.
- GitHub must be able to match the commit author to the username you entered.
- Large accounts or repositories can take longer because the backend checks commit pages in batches of 100.

## Useful links

- App link: [http://localhost:3000](http://localhost:3000)
- GitHub token settings: [https://github.com/settings/personal-access-tokens](https://github.com/settings/personal-access-tokens)
- GitHub docs for personal access tokens: [Managing your personal access tokens](https://docs.github.com/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token)
- GitHub docs for org token policy: [Setting a personal access token policy for your organization](https://docs.github.com/en/organizations/managing-programmatic-access-to-your-organization/setting-a-personal-access-token-policy-for-your-organization)
- GitHub docs for SSO token authorization: [Authorizing a personal access token for use with single sign-on](https://docs.github.com/articles/authorizing-a-personal-access-token-for-use-with-a-saml-single-sign-on-organization)
