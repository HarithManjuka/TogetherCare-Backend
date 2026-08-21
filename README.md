# 🌿 TogetherCare — Backend REST API

The core server-side service powering the **TogetherCare** intergenerational companionship platform. Built with Node.js, Express.js, and MongoDB.

---

## 🛠️ Tech Stack

* **Runtime**: Node.js
* **Framework**: Express.js
* **Database**: MongoDB (Mongoose ODM)
* **Authentication**: JSON Web Tokens (JWT) & bcryptjs
* **Architecture**: MVC / Layered Architecture

---

## 📁 Project Structure

\`\`\`text
TogetherCare-Backend/
├── config/          # Database connection settings
├── controllers/     # Business logic & request handling
├── middleware/      # Auth (JWT) & validation middleware
├── models/          # Mongoose database schemas
├── routes/          # API route definitions
├── .env.example     # Environment template
├── .gitignore       # Untracked files
├── package.json
└── server.js        # Server entry point
\`\`\`

---

## 🚀 Getting Started

### 1. Prerequisites
* Node.js (v18+)
* MongoDB installed locally or a MongoDB Atlas connection URI

### 2. Installation
\`\`\`bash
git clone https://github.com/<Your-Username>/TogetherCare-Backend.git
cd TogetherCare-Backend
npm install
\`\`\`

### 3. Environment Variables
Copy `.env.example` to `.env` and fill in the values:
\`\`\`bash
cp .env.example .env
\`\`\`

### 4. Run Development Server
\`\`\`bash
npm run dev
\`\`\`
The server will run on \`http://localhost:5001\`.