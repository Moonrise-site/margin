# Setting up sync (one time, about 5 minutes)

Sync goes through your own free Supabase project. Everything is encrypted on your device with your **sync passphrase** before it's uploaded. Supabase only stores scrambled data and never sees the passphrase.

## 1. Create the Supabase project

1. Sign up at **supabase.com** (free plan) and click **New project**. Any name and region works. Save the database password it asks for somewhere safe (Margin doesn't use it).
2. When the project is ready, open **SQL Editor → New query**. Paste everything from `supabase-setup.sql` (in this folder), then click **Run**. It should say "Success".
3. Optional but easier: go to **Authentication → Sign In / Providers → Email** and turn off **Confirm email**. If you leave it on, you'll need to click a link in an email after creating your account. That link may open a page that doesn't load; that's fine, the account is confirmed anyway.
4. Open **Project Settings → API** (or **Connect**) and copy two things:
   - the **Project URL** (`https://xxxx.supabase.co`)
   - the **Publishable key** (older projects call it the **anon public** key)

   Both are fine to paste into Margin. The publishable key is designed to be public; your data is protected by your login and your encryption.

## 2. Turn on sync on your first device

In Margin, open **⚙ Settings → Set up sync…**

1. Paste the Project URL and the key, enter your email and a password, then click **Create account**.
2. Choose a **sync passphrase** of 10+ characters. Write it down somewhere safe. If it's lost, the synced copy can't be decrypted (each device still keeps its own data).

## 3. Add your other devices

Do the same steps, but click **Sign in** instead of Create account. Use the same passphrase.
When it asks, choose **Use synced data** so the new device starts as an exact copy.

## Using Margin on your phone

A phone can't reach `localhost` on your Mac, so Margin has to be online at an `https://` address. It's just the app's files; your data never goes there. Then open that address in Safari on the iPhone, tap **Share → Add to Home Screen**, and set up sync as in step 3.

Margin is online at **https://moonrise-site.github.io/margin/** (published from the GitHub repository Moonrise-site/margin; pushing changes there updates it).

The online copy is a different address from `localhost`, so it starts empty. Sync brings everything across once you sign in.

## How sync behaves

- Changes sync a few seconds after you make them, every minute, and when you come back to the app. It also works offline and catches up later.
- If the same item is changed on two devices, the most recent change wins.
- The Vault syncs too. It's encrypted twice: once by your Vault master password and again by the sync passphrase. If it changes on another device, it locks here so you unlock the fresh copy.
- **Settings → Stop syncing on this device** disconnects without deleting anything.
