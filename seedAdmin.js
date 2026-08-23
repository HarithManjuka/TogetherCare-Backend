// seedAdmin.js
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('./models/User');
const { generateHumanReadableId } = require('./utils/customIdGenerator');

dotenv.config();

const createAdmin = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('🍃 MongoDB Connected for Seeding Admin...');

    const adminEmail = 'togethercareadmin@gmail.com';

    // Check if account already exists
    const existingAdmin = await User.findOne({ email: adminEmail });
    if (existingAdmin) {
      console.log('⚠️ Admin account already exists:', adminEmail);
      process.exit(0);
    }

    // Generate unique 8-character Admin ID (e.g., ADM-0001)
    const customId = await generateHumanReadableId('admin');

    // Create the admin user record
    const adminUser = await User.create({
      customId,
      firstName: 'Harith',
      lastName: 'Manjuka',
      email: adminEmail,
      password: 'admin123', // 👈 REPLACE with your specific password
      phone: '0788562080',
      role: 'admin',
      dateOfBirth: new Date('2002-01-30'),
      address: {
        streetAddress: 'No.65/A',
        city: 'Malabe',
        postalCode: '10115',
        district: 'Colombo',
        province: 'Western',
      },
      accountStatus: 'active',
      isVerified: true,
    });

    console.log('✅ Admin Account Created Successfully:');
    console.log(`   Custom ID : ${adminUser.customId}`);
    console.log(`   Name      : ${adminUser.firstName} ${adminUser.lastName}`);
    console.log(`   Email     : ${adminUser.email}`);
    console.log(`   Role      : ${adminUser.role}`);
    console.log(`   Status    : ${adminUser.accountStatus}`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating admin user:', error.message);
    process.exit(1);
  }
};

createAdmin();