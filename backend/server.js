import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

dotenv.config();
const app = express();
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173' }));
app.use(express.json());

const User = mongoose.model('User', new mongoose.Schema({
  name: String, email: { type: String, unique: true }, passwordHash: String, phone: String,
  role: { type: String, enum: ['user','responder','admin'], default: 'user' }
}, { timestamps: true }));

const Contact = mongoose.model('Contact', new mongoose.Schema({
  userId: mongoose.Schema.Types.ObjectId, name: String, phone: String, relationship: String, priority: Number
}, { timestamps: true }));

const Incident = mongoose.model('Incident', new mongoose.Schema({
  incidentNumber: String, userId: mongoose.Schema.Types.ObjectId, type: String, description: String,
  latitude: Number, longitude: Number, locationLabel: String,
  status: { type: String, enum: ['Active','Responding','Resolved','Cancelled'], default: 'Active' },
  severity: { type: String, default: 'Medium' }, resolvedAt: Date,
  responderId: mongoose.Schema.Types.ObjectId, responderName: String,
  notifiedContacts: [{ name: String, phone: String, relationship: String, priority: Number, delivery: String, notifiedAt: { type: Date, default: Date.now } }],
  activities: [{ action: String, actorName: String, actorRole: String, timestamp: { type: Date, default: Date.now } }]
}, { timestamps: true }));

const Notification = mongoose.model('Notification', new mongoose.Schema({
  userId: mongoose.Schema.Types.ObjectId, incidentId: mongoose.Schema.Types.ObjectId,
  title: String, message: String, type: String, read: { type: Boolean, default: false }
}, { timestamps: true }));

const auth = (req,res,next) => {
  try { const token=req.headers.authorization?.split(' ')[1]; if(!token) throw new Error(); req.user=jwt.verify(token,process.env.JWT_SECRET); next(); }
  catch { res.status(401).json({message:'Authentication required'}); }
};
const role = (...roles) => (req,res,next) => roles.includes(req.user.role) ? next() : res.status(403).json({message:`Access restricted to ${roles.join(', ')} users`});
const safe = v => String(v ?? '').trim();

app.get('/api/health',(req,res)=>res.json({message:'NOCTRA API running',status:'ok'}));

app.post('/api/auth/register',async(req,res)=>{
  try {
    const {name,email,password,phone,role:requestedRole,verificationCode}=req.body;
    if(!name||!email||!password||!phone) return res.status(400).json({message:'All fields are required'});
    const requested=requestedRole==='responder'?'responder':'user';
    if(requested==='responder' && safe(verificationCode)!==(process.env.RESPONDER_INVITE_CODE||'NOCTRA-RESPONDER')) return res.status(403).json({message:'Invalid responder verification code'});
    const normalized=safe(email).toLowerCase();
    if(await User.findOne({email:normalized})) return res.status(409).json({message:'Email already registered'});
    const u=await User.create({name:safe(name),email:normalized,phone:safe(phone),passwordHash:await bcrypt.hash(password,10),role:requested});
    const token=jwt.sign({id:u._id,role:u.role,name:u.name},process.env.JWT_SECRET,{expiresIn:'4h'});
    res.status(201).json({token,user:{id:u._id,name:u.name,email:u.email,role:u.role}});
  } catch { res.status(500).json({message:'Registration failed'}); }
});

app.post('/api/auth/login',async(req,res)=>{
  try {
    const u=await User.findOne({email:safe(req.body.email).toLowerCase()});
    if(!u||!(await bcrypt.compare(req.body.password||'',u.passwordHash))) return res.status(401).json({message:'Invalid email or password'});
    const token=jwt.sign({id:u._id,role:u.role,name:u.name},process.env.JWT_SECRET,{expiresIn:'4h'});
    res.json({token,user:{id:u._id,name:u.name,email:u.email,role:u.role}});
  } catch { res.status(500).json({message:'Login failed'}); }
});
app.get('/api/auth/me',auth,async(req,res)=>res.json({user:await User.findById(req.user.id).select('-passwordHash')}));

app.get('/api/contacts',auth,role('user'),async(req,res)=>res.json({contacts:await Contact.find({userId:req.user.id}).sort({priority:1})}));
app.post('/api/contacts',auth,role('user'),async(req,res)=>{
  const {name,phone,relationship,priority}=req.body;
  if(!name||!phone||!relationship) return res.status(400).json({message:'All contact fields are required'});
  res.status(201).json({contact:await Contact.create({userId:req.user.id,name,phone,relationship,priority:Number(priority)||1})});
});
app.delete('/api/contacts/:id',auth,role('user'),async(req,res)=>{await Contact.deleteOne({_id:req.params.id,userId:req.user.id});res.json({message:'Deleted'});});

const notifyResponders = async (incident, title='Emergency alert') => {
  const responders=await User.find({role:'responder'}).select('_id');
  if(responders.length) await Notification.insertMany(responders.map(r=>({userId:r._id,incidentId:incident._id,title,message:`${incident.incidentNumber} requires attention. Open the Responder Portal to acknowledge it.`,type:'responder_alert'})));
};
const createIncident=async(req,forceSOS=false)=>{
  const count=await Incident.countDocuments();
  const contacts=forceSOS ? await Contact.find({userId:req.user.id}).sort({priority:1}) : [];
  const incident=await Incident.create({
    incidentNumber:'NO-'+String(1001+count),userId:req.user.id,
    type:forceSOS?'Emergency':safe(req.body.type)||'Other',
    description:forceSOS?'SOS emergency alert':safe(req.body.description),
    latitude:req.body.latitude,longitude:req.body.longitude,locationLabel:req.body.locationLabel||'Not available',
    severity:forceSOS?'High':req.body.severity||'Medium',
    notifiedContacts:contacts.map(c=>({name:c.name,phone:c.phone,relationship:c.relationship,priority:c.priority,delivery:'pending'})),
    activities:[{action:'Incident created',actorName:req.user.name||'User',actorRole:'user'}]
  });

  // For the prototype, every trusted contact is included in one incident (not separate incidents).
  // If a contact is also a registered NOCTRA user with the same phone number, they receive an in-app alert.
  if(forceSOS && contacts.length){
    const phones=contacts.map(c=>safe(c.phone)).filter(Boolean);
    const recipients=await User.find({phone:{$in:phones},_id:{$ne:req.user.id}}).select('_id phone');
    const recipientPhones=new Set(recipients.map(r=>safe(r.phone)));
    incident.notifiedContacts=contacts.map(c=>({
      name:c.name,phone:c.phone,relationship:c.relationship,priority:c.priority,
      delivery:recipientPhones.has(safe(c.phone))?'in_app':'simulated',notifiedAt:new Date()
    }));
    await incident.save();
    if(recipients.length){
      await Notification.insertMany(recipients.map(r=>({
        userId:r._id,incidentId:incident._id,title:'Emergency alert',
        message:`${req.user.name||'A trusted contact'} has triggered SOS. Open NOCTRA to view incident ${incident.incidentNumber}.`,
        type:'contact_alert'
      })));
    }
  }

  const contactCount=incident.notifiedContacts?.length||0;
  await Notification.create({userId:req.user.id,incidentId:incident._id,title:'Emergency alert created',message:`Incident ${incident.incidentNumber} is active. ${contactCount} trusted contact${contactCount===1?'':'s'} ${contactCount===1?'has':'have'} been notified.`,type:'incident'});
  await notifyResponders(incident);
  return incident;
};

app.post('/api/incidents/sos',auth,role('user'),async(req,res)=>{try{res.status(201).json({incident:await createIncident(req,true)})}catch(e){res.status(500).json({message:'Could not create SOS incident'})}});
app.post('/api/incidents',auth,role('user'),async(req,res)=>{try{if(!req.body.description)return res.status(400).json({message:'Description is required'});res.status(201).json({incident:await createIncident(req)})}catch{res.status(500).json({message:'Could not create incident'})}});
app.get('/api/incidents',auth,role('user'),async(req,res)=>res.json({incidents:await Incident.find({userId:req.user.id}).sort({createdAt:-1})}));
app.get('/api/incidents/:id',auth,role('user'),async(req,res)=>{const i=await Incident.findOne({_id:req.params.id,userId:req.user.id});if(!i)return res.status(404).json({message:'Incident not found'});res.json({incident:i})});

// User can cancel an active incident or see status. Responder/admin owns response actions.
app.put('/api/incidents/:id',auth,role('user'),async(req,res)=>{
  const i=await Incident.findOne({_id:req.params.id,userId:req.user.id}); if(!i)return res.status(404).json({message:'Incident not found'});
  if(req.body.status!=='Cancelled') return res.status(403).json({message:'Response status is managed by the responder'});
  if(i.status==='Resolved') return res.status(400).json({message:'Resolved incident cannot be changed'});
  i.status='Cancelled'; i.activities.push({action:'Incident cancelled',actorName:req.user.name||'User',actorRole:'user'}); await i.save();
  await Notification.create({userId:i.userId,incidentId:i._id,title:'Incident cancelled',message:`${i.incidentNumber} was cancelled by the user.`,type:'status'});
  res.json({incident:i});
});
app.get('/api/notifications',auth,async(req,res)=>res.json({notifications:await Notification.find({userId:req.user.id}).sort({createdAt:-1})}));

// Responder portal: active incidents are visible to responder accounts for the demo response workflow.
app.get('/api/responder/dashboard',auth,role('responder'),async(req,res)=>{
  const [active,notifications]=await Promise.all([
    Incident.find({status:{$in:['Active','Responding']}}).sort({createdAt:-1}),
    Notification.find({userId:req.user.id,type:'responder_alert'}).sort({createdAt:-1}).limit(20)
  ]);
  res.json({activeIncidents:active,notifications});
});
app.get('/api/responder/incidents',auth,role('responder'),async(req,res)=>res.json({incidents:await Incident.find({status:{$in:['Active','Responding']}}).sort({createdAt:-1})}));
app.get('/api/responder/incidents/:id',auth,role('responder'),async(req,res)=>{const i=await Incident.findById(req.params.id);if(!i)return res.status(404).json({message:'Incident not found'});res.json({incident:i})});
app.put('/api/responder/incidents/:id',auth,role('responder','admin'),async(req,res)=>{
  const i=await Incident.findById(req.params.id); if(!i)return res.status(404).json({message:'Incident not found'});
  const next=req.body.status;
  const allowed=['Responding','Resolved'];
  if(!allowed.includes(next)) return res.status(400).json({message:'Responder can set only Responding or Resolved'});
  if(next==='Responding' && i.status==='Resolved') return res.status(400).json({message:'Incident is already resolved'});
  if(next==='Resolved' && !['Responding','Active'].includes(i.status)) return res.status(400).json({message:'Incident cannot be resolved from its current state'});
  if(next==='Responding') { i.responderId=req.user.id; i.responderName=req.user.name||'Responder'; i.status='Responding'; i.activities.push({action:'Alert acknowledged — responder is responding',actorName:req.user.name||'Responder',actorRole:req.user.role}); }
  if(next==='Resolved') { i.responderId=i.responderId||req.user.id; i.responderName=i.responderName||req.user.name||'Responder'; i.status='Resolved'; i.resolvedAt=new Date(); i.activities.push({action:'Help arrived — incident resolved',actorName:req.user.name||'Responder',actorRole:req.user.role}); }
  await i.save();
  await Notification.create({userId:i.userId,incidentId:i._id,title:`Incident ${next.toLowerCase()}`,message:`${i.incidentNumber} is now ${next}. ${i.responderName?`Responder: ${i.responderName}.`:''}`,type:'status'});
  res.json({incident:i});
});
app.put('/api/responder/notifications/:id/read',auth,role('responder'),async(req,res)=>{await Notification.updateOne({_id:req.params.id,userId:req.user.id},{$set:{read:true}});res.json({message:'Notification marked read'});});

app.get('/api/contact-alerts',auth,async(req,res)=>{
  const notifications=await Notification.find({userId:req.user.id,type:'contact_alert'}).sort({createdAt:-1}).limit(20);
  res.json({notifications});
});

app.get('/api/admin/dashboard',auth,role('admin'),async(req,res)=>{const [users,total,active,resolved]=await Promise.all([User.countDocuments({role:'user'}),Incident.countDocuments(),Incident.countDocuments({status:{$in:['Active','Responding']}}),Incident.countDocuments({status:'Resolved'})]);res.json({users,total,active,resolved})});
app.get('/api/admin/incidents',auth,role('admin'),async(req,res)=>res.json({incidents:await Incident.find().sort({createdAt:-1})}));
app.put('/api/admin/incidents/:id',auth,role('admin'),async(req,res)=>{const i=await Incident.findById(req.params.id);if(!i)return res.status(404).json({message:'Incident not found'});if(!['Active','Responding','Resolved','Cancelled'].includes(req.body.status))return res.status(400).json({message:'Invalid status'});i.status=req.body.status;if(i.status==='Resolved')i.resolvedAt=new Date();i.activities.push({action:`Admin changed status to ${i.status}`,actorName:req.user.name||'Admin',actorRole:'admin'});await i.save();await Notification.create({userId:i.userId,incidentId:i._id,title:'Incident status updated',message:`${i.incidentNumber} is now ${i.status}.`,type:'status'});res.json({incident:i})});

app.use((req,res)=>res.status(404).json({message:'Route not found'}));
mongoose.connect(process.env.MONGODB_URI).then(()=>app.listen(process.env.PORT||5000,()=>console.log('NOCTRA API running'))).catch(e=>{console.error('MongoDB connection failed',e.message);process.exit(1)});
