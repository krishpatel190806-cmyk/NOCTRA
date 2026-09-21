import mongoose from 'mongoose';import dotenv from 'dotenv';import bcrypt from 'bcryptjs';dotenv.config();
const User=mongoose.model('User',new mongoose.Schema({name:String,email:{type:String,unique:true},passwordHash:String,phone:String,role:String},{timestamps:true}));
await mongoose.connect(process.env.MONGODB_URI);
const users=[
{name:'NOCTRA Admin',email:'admin@noctra.demo',phone:'9999999999',role:'admin',password:'Admin@12345'},
{name:'Rahul Sharma',email:'responder@noctra.demo',phone:'9876543210',role:'responder',password:'Responder@12345'}
];
for(const x of users){await User.updateOne({email:x.email},{$set:{name:x.name,email:x.email,passwordHash:await bcrypt.hash(x.password,10),phone:x.phone,role:x.role}},{upsert:true})}
console.log('Demo accounts created:');console.log('Admin: admin@noctra.demo / Admin@12345');console.log('Responder: responder@noctra.demo / Responder@12345');await mongoose.disconnect();
