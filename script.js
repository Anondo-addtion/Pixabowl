/* Pixabowl - clean production client
   Firebase Auth + Firestore for data/auth.
   Cloudinary unsigned upload for images only.
*/

const appId = typeof __app_id !== 'undefined' ? __app_id : 'pixabowl-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined'
  ? JSON.parse(__firebase_config)
  : {
      apiKey: "AIzaSyDRaFQa4kyLPyom8XFvVkCFG4Wh01mZDlA",
      authDomain: "pixabowl.firebaseapp.com",
      projectId: "pixabowl",
      storageBucket: "pixabowl.firebasestorage.app",
      messagingSenderId: "736075854527",
      appId: "1:736075854527:web:2b4bc302d1a0e74b754c0a"
    };

const CLOUDINARY_CLOUD_NAME = "bfq3wa5j";
const CLOUDINARY_PRESET = "Pixabowl_perset";
const CLOUDINARY_UPLOAD_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(err => console.warn('Auth persistence unavailable:', err));
const db = firebase.firestore();
const USERS_COLL = db.collection('artifacts').doc(appId).collection('public').doc('data').collection('users');
const POSTS_COLL = db.collection('artifacts').doc(appId).collection('public').doc('data').collection('posts');
const REPORTS_COLL = db.collection('reports');
const ADMINS_COLL = db.collection('admins');

let currentUser = null;
let currentProfile = null;
let viewedUsername = null;
let unsubscribeProfile = null;
let unsubscribeFeed = null;
let selectedSignupAvatar = null;
let selectedEditAvatar = null;
let selectedPostImage = null;
let feedPosts = [];
let feedFilter = '';
let searchTimer = null;
let isAdmin = false;
let selectedReportPostId = null;

function showLoading(show, text = 'কানেক্ট হচ্ছে... ⏳') {
  const el = document.getElementById('loadingSpinner');
  if (!el) return;
  const span = el.querySelector('span');
  if (span) span.textContent = text;
  el.style.display = show ? 'flex' : 'none';
}

function showAlert(msg) {
  const el = document.getElementById('alertMessage');
  const modal = document.getElementById('customAlert');
  if (el) el.textContent = String(msg || 'কিছু একটা সমস্যা হয়েছে।');
  if (modal) modal.style.display = 'flex';
}

function closeAlert() {
  const modal = document.getElementById('customAlert');
  if (modal) modal.style.display = 'none';
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9._-]/g, '');
}

function createdAtMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value.seconds) return value.seconds * 1000;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}

function getErrorMessage(error) {
  const code = error?.code || '';
  const map = {
    'auth/email-already-in-use': 'এই email দিয়ে ইতিমধ্যে account আছে।',
    'auth/invalid-email': 'Email address-টি সঠিক নয়।',
    'auth/weak-password': 'Password কমপক্ষে ৬ অক্ষরের দিন।',
    'auth/user-not-found': 'এই account পাওয়া যায়নি।',
    'auth/wrong-password': 'Password ভুল হয়েছে।',
    'auth/invalid-credential': 'Email/Password সঠিক নয়।',
    'auth/too-many-requests': 'অনেকবার চেষ্টা হয়েছে। কিছুক্ষণ পরে আবার চেষ্টা করুন।',
    'auth/network-request-failed': 'Internet connection সমস্যা। আবার চেষ্টা করুন।',
    'permission-denied': 'Firebase permission denied। Firestore rules পরীক্ষা করুন।'
  };
  return map[code] || error?.message || 'অজানা একটি সমস্যা হয়েছে।';
}

function isImageFile(file) {
  return !!file && file.type && file.type.startsWith('image/');
}

function isVideoFile(file) {
  return !!file && ((file.type && file.type.startsWith('video/')) || /\.(mp4|mov|avi|mkv|webm|m4v)$/i.test(file.name || ''));
}

function validateImageFile(file) {
  if (!file) throw new Error('কোনো ছবি নির্বাচন করা হয়নি।');
  if (isVideoFile(file)) throw new Error('ভিডিও Pixabowl-এ upload করা যাবে না। শুধুমাত্র ছবি দেওয়া যাবে।');
  if (!isImageFile(file)) throw new Error('শুধুমাত্র image file upload করা যাবে।');
  if (file.size > 12 * 1024 * 1024) throw new Error('ছবির size 12 MB-এর কম হতে হবে।');
}

function previewFileToElement(file, element, fallback = '👤') {
  const reader = new FileReader();
  reader.onload = e => {
    if (!element) return;
    element.style.backgroundImage = `url("${e.target.result}")`;
    element.textContent = '';
  };
  reader.readAsDataURL(file);
}

function compressImage(file, maxSide = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    try {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('ছবি পড়া যায়নি।'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('ছবিটি পড়া যায়নি বা damaged।'));
        img.onload = () => {
          const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          const ctx = canvas.getContext('2d', {alpha: false});
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('ছবি compress করা যায়নি।')), 'image/jpeg', quality);
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    } catch (e) { reject(e); }
  });
}

async function uploadImage(file, folder) {
  validateImageFile(file);
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_PRESET) throw new Error('Image storage configuration missing.');

  const blob = await compressImage(file, folder === 'avatars' ? 700 : 1600, folder === 'avatars' ? 0.84 : 0.82);
  const form = new FormData();
  form.append('file', blob, `${folder}_${Date.now()}.jpg`);
  form.append('upload_preset', CLOUDINARY_PRESET);
  form.append('folder', `pixabowl/${folder}`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(CLOUDINARY_UPLOAD_URL, { method: 'POST', body: form, signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.secure_url) {
      throw new Error(data?.error?.message || `Image upload failed (${response.status}).`);
    }
    return data.secure_url;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Image upload timeout হয়েছে। Internet connection পরীক্ষা করে আবার চেষ্টা করুন।');
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

function previewSignupAvatar(event) {
  const file = event?.target?.files?.[0];
  if (!file) return;
  try {
    validateImageFile(file);
    selectedSignupAvatar = file;
    previewFileToElement(file, document.getElementById('signup-avatar-preview'));
  } catch (e) {
    event.target.value = '';
    selectedSignupAvatar = null;
    showAlert(getErrorMessage(e));
  }
}

function previewEditAvatar(event) {
  const file = event?.target?.files?.[0];
  if (!file) return;
  try {
    validateImageFile(file);
    selectedEditAvatar = file;
    previewFileToElement(file, document.getElementById('edit-avatar-preview'));
  } catch (e) {
    event.target.value = '';
    selectedEditAvatar = null;
    showAlert(getErrorMessage(e));
  }
}

function validateAndPreviewPostImage(event) {
  const file = event?.target?.files?.[0];
  if (!file) return;
  try {
    validateImageFile(file);
    selectedPostImage = file;
    const img = document.getElementById('post-image-preview');
    const placeholder = document.getElementById('picker-placeholder');
    if (img) {
      img.src = URL.createObjectURL(file);
      img.style.display = 'block';
    }
    if (placeholder) placeholder.style.display = 'none';
  } catch (e) {
    event.target.value = '';
    selectedPostImage = null;
    showAlert(getErrorMessage(e));
  }
}

async function getLegacyUserById(username) {
  const name = normalizeUsername(username);
  if (!name) return null;
  const snap = await USERS_COLL.doc(name).get();
  return snap.exists ? {id: snap.id, ...snap.data(), _source: 'legacy'} : null;
}

async function findUserByUid(uid) {
  if (!uid) return null;
  // Canonical location: users/{uid}
  const canonical = await db.collection('users').doc(uid).get();
  if (canonical.exists) return {id: canonical.id, ...canonical.data(), _source: 'canonical'};

  // Backward-compatible location used by earlier Pixabowl builds.
  const legacy = await USERS_COLL.where('uid', '==', uid).limit(1).get();
  if (!legacy.empty) return {id: legacy.docs[0].id, ...legacy.docs[0].data(), _source: 'legacy'};
  return null;
}

async function findUserByUsername(username) {
  const name = normalizeUsername(username);
  if (!name) return null;

  // Fast path for the old username-keyed documents.
  const legacy = await getLegacyUserById(name);
  if (legacy) return legacy;

  // Canonical documents are keyed by Firebase UID, so search the username field.
  const canonical = await db.collection('users').where('username', '==', name).limit(1).get();
  if (!canonical.empty) return {id: canonical.docs[0].id, ...canonical.docs[0].data(), _source: 'canonical'};
  return null;
}

async function writeUserProfile(uid, data, existingProfile = null) {
  if (!uid) throw new Error('Firebase UID পাওয়া যায়নি।');
  const clean = {
    uid,
    username: normalizeUsername(data.username || existingProfile?.username),
    email: String(data.email || existingProfile?.email || '').trim().toLowerCase(),
    fullName: String(data.fullName || existingProfile?.fullName || '').trim(),
    bio: String(data.bio || existingProfile?.bio || '').trim(),
    avatarUrl: String(data.avatarUrl ?? existingProfile?.avatarUrl ?? ''),
    followers: Array.isArray(data.followers) ? data.followers : (Array.isArray(existingProfile?.followers) ? existingProfile.followers : []),
    following: Array.isArray(data.following) ? data.following : (Array.isArray(existingProfile?.following) ? existingProfile.following : []),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  if (!clean.username) throw new Error('Username পাওয়া যায়নি।');

  // Canonical record. This is now the source of truth for new/updated profiles.
  await db.collection('users').doc(uid).set({ ...clean, createdAt: existingProfile?.createdAt || firebase.firestore.FieldValue.serverTimestamp() }, {merge: true});

  // Keep the old username-keyed record synchronized when it already exists.
  try {
    const oldRef = USERS_COLL.doc(clean.username);
    const oldSnap = await oldRef.get();
    if (oldSnap.exists) await oldRef.set(clean, {merge: true});
  } catch (e) {
    console.warn('Legacy profile sync skipped:', e);
  }
  return {id: uid, ...clean, _source: 'canonical'};
}

async function usernameExists(username, exceptUid = null) {
  const profile = await findUserByUsername(username);
  return !!profile && profile.uid !== exceptUid;
}

async function ensureProfileForAuthUser(user, supplied = {}) {
  if (!user) return null;
  let profile = await findUserByUid(user.uid);
  if (profile) {
    // Migrate/synchronize the profile to the canonical UID document.
    return await writeUserProfile(user.uid, {
      username: supplied.username || profile.username,
      email: user.email || profile.email,
      fullName: supplied.fullName || profile.fullName || user.displayName || '',
      bio: supplied.bio ?? profile.bio ?? '',
      avatarUrl: supplied.avatarUrl ?? profile.avatarUrl ?? user.photoURL ?? '',
      followers: profile.followers,
      following: profile.following
    }, profile);
  }

  const username = normalizeUsername(supplied.username || user.displayName || String(user.email || '').split('@')[0]);
  if (!username) throw new Error('Profile-এর জন্য username পাওয়া যায়নি।');
  const taken = await findUserByUsername(username);
  if (taken && taken.uid !== user.uid) throw new Error('এই username ইতোমধ্যেই অন্য account-এর।');
  return await writeUserProfile(user.uid, {
    username,
    email: user.email || supplied.email || '',
    fullName: supplied.fullName || user.displayName || username,
    bio: supplied.bio || '',
    avatarUrl: supplied.avatarUrl || user.photoURL || '',
    followers: [], following: []
  });
}

async function handleSignUp() {
  const fullname = document.getElementById('signup-fullname')?.value.trim();
  const username = normalizeUsername(document.getElementById('signup-username')?.value);
  const email = document.getElementById('signup-email')?.value.trim().toLowerCase();
  const bio = document.getElementById('signup-bio')?.value.trim() || '';
  const password = document.getElementById('signup-password')?.value || '';

  if (!fullname || !username || !email || !password) return showAlert('Full Name, Username, Email এবং Password সবগুলো দিন।');
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) return showAlert('Username 3-30 characters-এর হতে হবে এবং শুধু a-z, 0-9, ., _, - ব্যবহার করুন।');
  if (password.length < 6) return showAlert('Password কমপক্ষে ৬ অক্ষরের দিন।');

  showLoading(true, 'Account যাচাই হচ্ছে...');
  try {
    const existingUsername = await findUserByUsername(username);
    if (existingUsername && existingUsername.email && existingUsername.email.toLowerCase() !== email) {
      throw new Error('এই username ইতিমধ্যেই অন্য account-এর। অন্য username দিন।');
    }

    let credential;
    try {
      credential = await auth.createUserWithEmailAndPassword(email, password);
    } catch (e) {
      // If the Auth account already exists, use the supplied credentials to sign in
      // and repair/synchronize its profile instead of creating another account.
      if (e.code !== 'auth/email-already-in-use') throw e;
      showLoading(true, 'আগের account যাচাই করে profile ঠিক করা হচ্ছে...');
      credential = await auth.signInWithEmailAndPassword(email, password);
    }

    let avatarUrl = selectedSignupAvatar ? await uploadImage(selectedSignupAvatar, 'avatars') : '';
    const profile = await ensureProfileForAuthUser(credential.user, {
      username,
      email,
      fullName: fullname,
      bio,
      avatarUrl
    });
    await credential.user.updateProfile({displayName: fullname, photoURL: avatarUrl || credential.user.photoURL || null});

    selectedSignupAvatar = null;
    currentUser = credential.user;
    currentProfile = profile;
    viewedUsername = profile.username;
    showAlert('Account/Profile সফলভাবে প্রস্তুত হয়েছে! 🎉');
    await renderProfile(profile, true);
    navigateToScreen('screen-profile');
  } catch (e) {
    console.error('SIGNUP_OR_REPAIR_ERROR', e);
    showAlert(`Account/Profile তৈরি করা যায়নি: ${getErrorMessage(e)}`);
  } finally {
    showLoading(false);
  }
}

async function handleLogin() {
  const login = document.getElementById('login-username')?.value.trim();
  const password = document.getElementById('login-password')?.value || '';
  if (!login || !password) return showAlert('Username/Email এবং Password দিন।');

  showLoading(true, 'Log in হচ্ছে...');
  try {
    let email = login.toLowerCase();
    let usernameHint = '';
    if (!login.includes('@')) {
      const profile = await findUserByUsername(login);
      if (!profile?.email) throw new Error('এই username-এর সঙ্গে কোনো email profile পাওয়া যায়নি।');
      email = String(profile.email).trim().toLowerCase();
      usernameHint = profile.username;
    }
    const credential = await auth.signInWithEmailAndPassword(email, password);
    await ensureProfileForAuthUser(credential.user, {username: usernameHint, email: credential.user.email});
  } catch (e) {
    console.error('LOGIN_ERROR', e);
    showAlert(`Log in করা যায়নি: ${getErrorMessage(e)}`);
  } finally {
    showLoading(false);
  }
}

async function handleForgotPassword() {
  const loginEl = document.getElementById('login-username');
  const login = loginEl?.value.trim() || '';
  if (!login) {
    showAlert('আপনার Email অথবা Username লিখুন।');
    loginEl?.focus();
    return;
  }

  let email = login.toLowerCase();
  if (!login.includes('@')) {
    showLoading(true, 'Username থেকে email খোঁজা হচ্ছে...');
    try {
      const profile = await findUserByUsername(login);
      if (!profile?.email) throw new Error('এই username-এর সঙ্গে কোনো email profile পাওয়া যায়নি।');
      email = String(profile.email).trim().toLowerCase();
    } catch (e) {
      console.error('FORGOT_PASSWORD_PROFILE_LOOKUP_ERROR', e);
      showAlert(`Password reset করা যায়নি: ${getErrorMessage(e)}`);
      showLoading(false);
      return;
    }
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showAlert('Email address-টি সঠিক নয়।');
    showLoading(false);
    return;
  }

  showLoading(true, 'Reset email পাঠানো হচ্ছে...');
  try {
    await auth.sendPasswordResetEmail(email);
    showAlert(`Password reset link ${email} ঠিকানায় পাঠানো হয়েছে। Inbox এবং Spam/Junk folder দেখুন।`);
  } catch (e) {
    console.error('FORGOT_PASSWORD_ERROR', e);
    showAlert(`Reset email পাঠানো যায়নি: ${getErrorMessage(e)}`);
  } finally {
    showLoading(false);
  }
}

function toggleAuthScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
  document.getElementById('bottomNav')?.classList.remove('visible');
}

function navigateToScreen(id, navButton) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
  const nav = document.getElementById('bottomNav');
  if (currentUser) nav?.classList.add('visible');
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  if (navButton) navButton.classList.add('active');
  if (id === 'screen-feed') loadFeed();
  if (id === 'screen-profile') loadOwnProfile();
}

async function loadOwnProfile(usernameOverride) {
  if (!currentUser) return;
  let profile = null;
  if (usernameOverride) profile = await findUserByUsername(usernameOverride);
  if (!profile) {
    const snap = await USERS_COLL.where('uid', '==', currentUser.uid).limit(1).get();
    if (!snap.empty) profile = {id: snap.docs[0].id, ...snap.docs[0].data()};
  }
  if (profile) {
    viewedUsername = profile.username;
    await renderProfile(profile, true);
  }
}

async function renderProfile(profile, isOwn = false) {
  currentProfile = profile;
  viewedUsername = profile.username;
  document.getElementById('profile-display-fullname').textContent = profile.fullName || profile.username || 'User';
  document.getElementById('profile-display-bio').textContent = profile.bio || '';
  const pic = document.getElementById('profile-display-pic');
  pic.style.backgroundImage = profile.avatarUrl ? `url("${profile.avatarUrl}")` : 'none';
  pic.textContent = profile.avatarUrl ? '' : '👤';

  const followers = Array.isArray(profile.followers) ? profile.followers : [];
  const following = Array.isArray(profile.following) ? profile.following : [];
  document.getElementById('profile-followers-count').textContent = followers.length;
  document.getElementById('profile-following-count').textContent = following.length;

  const editBtn = document.getElementById('btn-edit-profile');
  const followBtn = document.getElementById('btn-follow');
  if (isOwn || profile.uid === currentUser?.uid) {
    editBtn.style.display = '';
    followBtn.style.display = 'none';
  } else {
    editBtn.style.display = 'none';
    followBtn.style.display = '';
    const me = await getCurrentProfile();
    const followingMe = Array.isArray(me?.following) && me.following.includes(profile.username);
    followBtn.textContent = followingMe ? 'Following' : 'Follow';
  }
  await loadProfilePosts(profile.username);
}

async function getCurrentProfile() {
  if (!currentUser) return null;
  return await findUserByUid(currentUser.uid);
}

async function openUserProfile(username) {
  const profile = await findUserByUsername(username);
  if (!profile) return showAlert('User পাওয়া যায়নি।');
  await renderProfile(profile, profile.uid === currentUser?.uid);
  navigateToScreen('screen-profile');
}

async function toggleFollowProfile() {
  if (!currentUser || !currentProfile || currentProfile.uid === currentUser.uid) return;
  const me = await getCurrentProfile();
  if (!me) return showAlert('আপনার profile পাওয়া যায়নি।');
  const target = await findUserByUid(currentProfile.uid);
  if (!target) return showAlert('Target profile পাওয়া যায়নি।');
  const meRef = db.collection('users').doc(currentUser.uid);
  const targetRef = db.collection('users').doc(target.uid);
  const already = Array.isArray(me.following) && me.following.includes(target.username);
  showLoading(true, already ? 'Unfollow হচ্ছে...' : 'Follow হচ্ছে...');
  try {
    await db.runTransaction(async tx => {
      const [meSnap, targetSnap] = await Promise.all([tx.get(meRef), tx.get(targetRef)]);
      if (!meSnap.exists || !targetSnap.exists) throw new Error('Profile data missing.');
      const meData = meSnap.data();
      const targetData = targetSnap.data();
      const following = Array.isArray(meData.following) ? [...meData.following] : [];
      const followers = Array.isArray(targetData.followers) ? [...targetData.followers] : [];
      if (already) {
        tx.update(meRef, {following: following.filter(x => x !== target.username)});
        tx.update(targetRef, {followers: followers.filter(x => x !== me.username)});
      } else {
        if (!following.includes(target.username)) following.push(target.username);
        if (!followers.includes(me.username)) followers.push(me.username);
        tx.update(meRef, {following});
        tx.update(targetRef, {followers});
      }
    });
    const refreshed = await findUserByUid(target.uid);
    await renderProfile(refreshed, false);
  } catch (e) {
    showAlert(`Follow পরিবর্তন করা যায়নি: ${getErrorMessage(e)}`);
  } finally { showLoading(false); }
}

async function loadProfilePosts(username) {
  const grid = document.getElementById('profile-grid');
  grid.innerHTML = '';
  try {
    const snap = await POSTS_COLL.where('username', '==', username).limit(60).get();
    const docs = snap.docs.map(d => ({id:d.id, ...d.data()})).sort((a,b) => createdAtMillis(b.createdAt) - createdAtMillis(a.createdAt));
    document.getElementById('profile-post-count').textContent = docs.length;
    if (!docs.length) {
      grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1">এখনও কোনো post নেই।</div>';
      return;
    }
    docs.forEach(post => {
      if (!post.imageUrl && !post.image) return;
      const item = document.createElement('div');
      item.className = 'grid-item';
      item.style.backgroundImage = `url("${post.imageUrl || post.image}")`;
      item.onclick = () => showAlert(post.caption || 'Photo post');
      grid.appendChild(item);
    });
  } catch (e) {
    console.error('PROFILE_POSTS_ERROR', e);
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1">Posts load করা যায়নি।</div>';
  }
}

async function saveProfileEdits() {
  if (!currentUser) return;
  const profile = await getCurrentProfile();
  if (!profile) return showAlert('Profile পাওয়া যায়নি।');
  const fullName = document.getElementById('edit-fullname')?.value.trim() || profile.fullName || '';
  const bio = document.getElementById('edit-bio')?.value.trim() || '';
  showLoading(true, 'Profile save হচ্ছে...');
  try {
    let avatarUrl = profile.avatarUrl || '';
    if (selectedEditAvatar) avatarUrl = await uploadImage(selectedEditAvatar, 'avatars');
    await writeUserProfile(currentUser.uid, {username: profile.username, email: profile.email || currentUser.email, fullName, bio, avatarUrl, followers: profile.followers, following: profile.following}, profile);
    await currentUser.updateProfile({displayName: fullName, photoURL: avatarUrl || null});
    selectedEditAvatar = null;
    closeEditProfileModal();
    await loadOwnProfile(profile.username);
    showAlert('Profile updated successfully! ✨');
  } catch (e) {
    showAlert(`Profile save করা যায়নি: ${getErrorMessage(e)}`);
  } finally { showLoading(false); }
}

async function openEditProfileModal() {
  const profile = await getCurrentProfile();
  if (!profile) return showAlert('Profile পাওয়া যায়নি।');
  document.getElementById('edit-fullname').value = profile.fullName || '';
  document.getElementById('edit-bio').value = profile.bio || '';
  const preview = document.getElementById('edit-avatar-preview');
  preview.textContent = profile.avatarUrl ? '' : '👤';
  preview.style.backgroundImage = profile.avatarUrl ? `url("${profile.avatarUrl}")` : 'none';
  selectedEditAvatar = null;
  document.getElementById('editProfileModal').style.display = 'flex';
}

function closeEditProfileModal() {
  document.getElementById('editProfileModal').style.display = 'none';
}

function extractHashtags(text) {
  return [...new Set((String(text || '').match(/#[\p{L}\p{N}_]+/gu) || []).map(x => x.slice(1).toLowerCase()))];
}

async function publishPost() {
  if (!currentUser) return showAlert('আগে Log in করুন।');
  const caption = document.getElementById('caption-input')?.value.trim() || '';
  if (!caption && !selectedPostImage) return showAlert('একটি ছবি অথবা কিছু text লিখে post করুন।');
  if (selectedPostImage) {
    try { validateImageFile(selectedPostImage); } catch (e) { return showAlert(getErrorMessage(e)); }
  }

  showLoading(true, 'Post publish হচ্ছে...');
  try {
    const me = await getCurrentProfile();
    if (!me) throw new Error('User profile পাওয়া যায়নি।');
    let imageUrl = '';
    if (selectedPostImage) imageUrl = await uploadImage(selectedPostImage, 'posts');

    await POSTS_COLL.add({
      uid: currentUser.uid,
      username: me.username,
      fullName: me.fullName || me.username,
      avatarUrl: me.avatarUrl || '',
      imageUrl,
      caption,
      hashtags: extractHashtags(caption),
      likes: [],
      comments: [],
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    selectedPostImage = null;
    const input = document.getElementById('post-file-input');
    if (input) input.value = '';
    const img = document.getElementById('post-image-preview');
    const placeholder = document.getElementById('picker-placeholder');
    if (img) { img.src = ''; img.style.display = 'none'; }
    if (placeholder) placeholder.style.display = 'block';
    document.getElementById('caption-input').value = '';
    navigateToScreen('screen-feed');
    showAlert('Post published! 🎉');
  } catch (e) {
    console.error('PUBLISH_ERROR', e);
    showAlert(`Post publish করা যায়নি: ${getErrorMessage(e)}`);
  } finally { showLoading(false); }
}

async function loadFeed() {
  if (!currentUser) return;
  if (unsubscribeFeed) unsubscribeFeed();
  const container = document.getElementById('feed-container');
  container.innerHTML = '<div class="empty-state">Feed load হচ্ছে...</div>';
  try {
    unsubscribeFeed = POSTS_COLL.orderBy('createdAt', 'desc').limit(50).onSnapshot(snapshot => {
      feedPosts = snapshot.docs.map(d => ({id:d.id, ...d.data()}));
      renderFeed();
    }, error => {
      console.error('FEED_SNAPSHOT_ERROR', error);
      container.innerHTML = `<div class="empty-state">Feed load করা যায়নি।<br>${escapeHtml(getErrorMessage(error))}</div>`;
    });
  } catch (e) {
    container.innerHTML = `<div class="empty-state">Feed error: ${escapeHtml(getErrorMessage(e))}</div>`;
  }
}

function renderCaption(caption) {
  const safe = escapeHtml(caption || '');
  return safe.replace(/(^|\s)(#[\w\u0980-\u09FF]+)/g, '$1<span class="hashtag" data-tag="$2">$2</span>');
}

function renderFeed() {
  const container = document.getElementById('feed-container');
  let posts = feedPosts;
  const query = feedFilter.trim().toLowerCase();
  if (query) {
    const q = query.startsWith('#') ? query.slice(1) : query;
    posts = posts.filter(p => String(p.username || '').toLowerCase().includes(q) || (Array.isArray(p.hashtags) && p.hashtags.some(h => String(h).toLowerCase().includes(q))));
  }
  if (!posts.length) {
    container.innerHTML = '<div class="empty-state">কোনো post পাওয়া যায়নি।</div>';
    return;
  }
  container.innerHTML = posts.map(post => {
    const likes = Array.isArray(post.likes) ? post.likes : [];
    const liked = currentUser && likes.includes(currentUser.uid);
    const image = post.imageUrl || post.image || '';
    const comments = Array.isArray(post.comments) ? post.comments : [];
    return `<article class="post-card" data-post-id="${escapeHtml(post.id)}">
      <div class="post-header">
        <div class="post-avatar" style="${post.avatarUrl ? `background-image:url('${escapeHtml(post.avatarUrl)}')` : ''}">${post.avatarUrl ? '' : '👤'}</div>
        <div class="post-username" onclick="openUserProfile('${escapeHtml(post.username || '')}')">${escapeHtml(post.username || 'user')}</div>
        <button class="post-menu-btn" title="Report" onclick="openReportModal('${escapeHtml(post.id)}')">⋮</button>
      </div>
      ${image ? `<img class="post-image" src="${escapeHtml(image)}" alt="Post image" loading="lazy" ondblclick="likePost('${escapeHtml(post.id)}', this)">` : ''}
      ${post.caption ? `<div class="post-body">${renderCaption(post.caption)}</div>` : ''}
      <div class="post-actions">
        <div class="like-btn-container" onclick="likePost('${escapeHtml(post.id)}', this)">
          <span class="like-icon">${liked ? '♥' : '♡'}</span><span class="likes-count">${likes.length}</span>
        </div>
        <span class="post-id-tag">${comments.length} comment${comments.length === 1 ? '' : 's'}</span>
      </div>
    </article>`;
  }).join('');
}

async function likePost(postId, target) {
  if (!currentUser) return;
  const ref = POSTS_COLL.doc(postId);
  try {
    await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error('Post পাওয়া যায়নি।');
      const data = snap.data();
      const likes = Array.isArray(data.likes) ? [...data.likes] : [];
      const index = likes.indexOf(currentUser.uid);
      if (index >= 0) likes.splice(index, 1); else likes.push(currentUser.uid);
      tx.update(ref, {likes});
    });
    const card = target?.closest?.('.post-card');
    if (card) {
      card.style.transform = 'scale(1.01)';
      setTimeout(() => card.style.transform = '', 140);
    }
  } catch (e) { showAlert(`Like করা যায়নি: ${getErrorMessage(e)}`); }
}

async function checkAdminStatus() {
  isAdmin = false;
  if (!currentUser) return false;
  try {
    const snap = await ADMINS_COLL.doc(currentUser.uid).get();
    isAdmin = snap.exists && snap.data()?.enabled !== false;
  } catch (e) {
    console.warn('ADMIN_CHECK_ERROR', e);
    isAdmin = false;
  }
  const btn = document.getElementById('btn-admin-panel');
  if (btn) btn.style.display = isAdmin ? 'inline-flex' : 'none';
  return isAdmin;
}

function openReportModal(postId) {
  if (!currentUser) return showAlert('Report করতে আগে Log in করুন।');
  if (!postId) return showAlert('Post ID পাওয়া যায়নি।');
  selectedReportPostId = postId;
  const modal = document.getElementById('reportModal');
  const reason = document.getElementById('report-reason');
  const details = document.getElementById('report-details');
  if (reason) reason.value = 'spam';
  if (details) details.value = '';
  if (modal) modal.style.display = 'flex';
}

function closeReportModal() {
  selectedReportPostId = null;
  const modal = document.getElementById('reportModal');
  if (modal) modal.style.display = 'none';
}

async function submitReport() {
  if (!currentUser) return showAlert('Report করতে আগে Log in করুন।');
  if (!selectedReportPostId) return closeReportModal();
  const postId = selectedReportPostId;
  const reason = document.getElementById('report-reason')?.value || 'other';
  const details = (document.getElementById('report-details')?.value || '').trim().slice(0, 500);
  showLoading(true, 'Report পাঠানো হচ্ছে...');
  try {
    const postSnap = await POSTS_COLL.doc(postId).get();
    if (!postSnap.exists) throw new Error('Post আর পাওয়া যাচ্ছে না।');
    const post = postSnap.data();
    const reportId = `${postId}_${currentUser.uid}`;
    const ref = REPORTS_COLL.doc(reportId);
    const existing = await ref.get();
    if (existing.exists && existing.data()?.status === 'pending') {
      throw new Error('আপনি এই post-টি ইতিমধ্যে report করেছেন।');
    }
    await ref.set({
      postId,
      postOwnerUid: post.uid || '',
      postOwnerUsername: post.username || '',
      reporterUid: currentUser.uid,
      reporterUsername: currentProfile?.username || '',
      reason,
      details,
      status: 'pending',
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      reviewedAt: null,
      reviewedBy: null
    }, {merge: true});
    closeReportModal();
    showAlert('Report সফলভাবে পাঠানো হয়েছে। একজন moderator এটি review করবেন।');
  } catch (e) {
    console.error('REPORT_ERROR', e);
    showAlert(`Report পাঠানো যায়নি: ${getErrorMessage(e)}`);
  } finally { showLoading(false); }
}

async function openAdminPanel() {
  if (!(await checkAdminStatus())) return showAlert('আপনার admin access নেই।');
  navigateToScreen('screen-admin');
  await loadAdminReports();
}

async function loadAdminReports() {
  if (!(await checkAdminStatus())) return showAlert('আপনার admin access নেই।');
  const container = document.getElementById('admin-reports-container');
  if (!container) return;
  container.innerHTML = '<div class="empty-state">Reports load হচ্ছে...</div>';
  try {
    const snap = await REPORTS_COLL.where('status', '==', 'pending').limit(50).get();
    if (snap.empty) {
      container.innerHTML = '<div class="empty-state">🎉 কোনো pending report নেই।</div>';
      return;
    }
    const reports = snap.docs.map(d => ({id:d.id, ...d.data()})).sort((a,b) => createdAtMillis(b.createdAt) - createdAtMillis(a.createdAt));
    container.innerHTML = reports.map(report => `
      <div class="admin-report-card">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;">
          <strong>⚠️ ${escapeHtml(report.reason || 'other')}</strong>
          <small>${createdAtMillis(report.createdAt) ? new Date(createdAtMillis(report.createdAt)).toLocaleString() : 'just now'}</small>
        </div>
        <div style="font-size:13px;margin-top:8px;">Post: <b>@${escapeHtml(report.postOwnerUsername || 'unknown')}</b></div>
        <div style="font-size:12px;opacity:.75;margin-top:4px;">Reporter: @${escapeHtml(report.reporterUsername || 'unknown')}</div>
        ${report.details ? `<div class="admin-report-details">${escapeHtml(report.details)}</div>` : ''}
        <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">
          <button class="alert-btn" onclick="adminRemovePost('${escapeHtml(report.id)}','${escapeHtml(report.postId)}')">🗑️ Remove post</button>
          <button class="alert-btn" style="background:#777;" onclick="adminDismissReport('${escapeHtml(report.id)}')">Dismiss</button>
        </div>
      </div>`).join('');
  } catch (e) {
    console.error('ADMIN_REPORTS_ERROR', e);
    container.innerHTML = `<div class="empty-state">Reports load করা যায়নি।<br>${escapeHtml(getErrorMessage(e))}</div>`;
  }
}

async function adminDismissReport(reportId) {
  if (!(await checkAdminStatus())) return showAlert('Admin access নেই।');
  try {
    await REPORTS_COLL.doc(reportId).update({status:'dismissed', reviewedAt:firebase.firestore.FieldValue.serverTimestamp(), reviewedBy:currentUser.uid});
    await loadAdminReports();
  } catch (e) { showAlert(`Report dismiss করা যায়নি: ${getErrorMessage(e)}`); }
}

async function adminRemovePost(reportId, postId) {
  if (!(await checkAdminStatus())) return showAlert('Admin access নেই।');
  if (!postId) return showAlert('Post ID পাওয়া যায়নি।');
  showLoading(true, 'Post remove করা হচ্ছে...');
  try {
    await POSTS_COLL.doc(postId).delete();
    await REPORTS_COLL.doc(reportId).update({status:'actioned', action:'post_removed', reviewedAt:firebase.firestore.FieldValue.serverTimestamp(), reviewedBy:currentUser.uid});
    showAlert('Post remove করা হয়েছে এবং report resolved হয়েছে।');
    await loadAdminReports();
  } catch (e) {
    console.error('ADMIN_REMOVE_POST_ERROR', e);
    showAlert(`Post remove করা যায়নি: ${getErrorMessage(e)}`);
  } finally { showLoading(false); }
}

function onFeedSearchInput(event) {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    feedFilter = event.target.value || '';
    renderFeed();
  }, 180);
}

function loadMoreFeed() {
  showAlert('বর্তমান feed-এর সর্বশেষ ৫০টি post দেখানো হচ্ছে। আরও scalable pagination পরের backend phase-এ যোগ করা যাবে।');
}

function closeAllTransientModals() {
  closeAlert();
  closeEditProfileModal();
  closeReportModal();
}

async function handleLogout() {
  showLoading(true, 'Log out হচ্ছে...');
  try { await auth.signOut(); }
  catch (e) { showAlert(`Log out করা যায়নি: ${getErrorMessage(e)}`); }
  finally { showLoading(false); }
}

function setFeedHeaderAvatar(profile) {
  const el = document.getElementById('feed-header-avatar');
  if (!el) return;
  el.style.backgroundImage = profile?.avatarUrl ? `url("${profile.avatarUrl}")` : 'none';
  el.textContent = profile?.avatarUrl ? '' : '👤';
}

auth.onAuthStateChanged(async user => {
  currentUser = user || null;
  try {
    if (user) {
      // Never bounce a valid Auth user to Signup merely because a profile is missing.
      // If necessary, create/synchronize a minimal profile automatically.
      let profile = await getCurrentProfile();
      if (!profile) {
        const rememberedUsername = normalizeUsername(localStorage.getItem('pixabowl_pending_username') || '');
        profile = await ensureProfileForAuthUser(user, {username: rememberedUsername, email: user.email});
        localStorage.removeItem('pixabowl_pending_username');
      }
      currentProfile = profile;
      viewedUsername = profile.username;
      await checkAdminStatus();
      setFeedHeaderAvatar(profile);
      document.getElementById('bottomNav')?.classList.add('visible');
      await renderProfile(profile, true);
      navigateToScreen('screen-profile', document.getElementById('btn-nav-profile'));
    } else {
      if (unsubscribeFeed) { unsubscribeFeed(); unsubscribeFeed = null; }
      currentProfile = null;
      document.getElementById('bottomNav')?.classList.remove('visible');
      toggleAuthScreen('screen-login');
    }
  } catch (e) {
    console.error('AUTH_STATE_ERROR', e);
    showLoading(false);
    showAlert(`Account load করা যায়নি: ${getErrorMessage(e)}`);
    toggleAuthScreen('screen-login');
  }
});

window.addEventListener('error', event => {
  console.error('GLOBAL_ERROR', event.error || event.message);
  showLoading(false);
});
window.addEventListener('unhandledrejection', event => {
  console.error('UNHANDLED_REJECTION', event.reason);
  showLoading(false);
});

// Keep the existing inline onclick handlers working.
Object.assign(window, {
  showLoading, showAlert, closeAlert, previewSignupAvatar, previewEditAvatar,
  validateAndPreviewPostImage, handleSignUp, handleLogin, handleForgotPassword,
  toggleAuthScreen, navigateToScreen, openEditProfileModal, closeEditProfileModal,
  saveProfileEdits, publishPost, loadMoreFeed, onFeedSearchInput, likePost,
  openUserProfile, toggleFollowProfile, handleLogout
});
