import * as Vue from 'https://unpkg.com/vue@3/dist/vue.esm-browser.js'
import { mixin } from "https://mavue.mavo.io/mavue.js";
import GraffitiPlugin from 'https://graffiti.garden/graffiti-js/plugins/vue/plugin.js'
import Resolver from './resolver.js'

const app = {
  // Import MaVue
  mixins: [mixin],

  // Import resolver
  created() {
    this.resolver = new Resolver(this.$gf)
  },

  setup() {

    // Initialize the name of the channel we're chatting in
    const channel = Vue.ref('default')

    // And a flag for whether or not we're private-messaging
    const privateMessaging = Vue.ref(false)

    // If we're private messaging use "me" as the channel,
    // otherwise use the channel value
    const $gf = Vue.inject('graffiti')
    const context = Vue.computed(()=> privateMessaging.value? [$gf.me] : [channel.value])

    // Initialize the collection of messages associated with the context
    const { objects: messagesRaw } = $gf.useObjects(context)
    return { channel, privateMessaging, messagesRaw }
  },

  data() {
    // Initialize some more reactive variables
    return {
      messageText: '',
      editID: '',
      editText: '',
      recipient: '',
      recipientUsername: undefined,
      showActorIdError: false,
      username: undefined,
      showRequestError: false,
      actorsToUsernames: {},
      file: undefined,
      downloadedImages: {},
      showReadReceipts: false,
      viewingThreads: false,
      currentThread: undefined,
      editingProfilePic: false,
      profilePic: undefined,
      profilePicTemp: undefined
    }
  },

  watch: {

    async messagesWithImages(newMessages) {
      const lastMessage = newMessages.pop()
      if (lastMessage === undefined) return;

      if (!this.downloadedImages[lastMessage.attachment.magnet]) {
        const media = await this.$gf.media.fetch(lastMessage.attachment.magnet);
        const link = URL.createObjectURL(media);
        this.downloadedImages[lastMessage.attachment.magnet] = link;
      }
    },

    async allMessages(newMessages) {
      const lastMessage = newMessages.pop();

      if (lastMessage === undefined) return;

      // const readReceipts = this.readReceipts.filter(m => m.actor === this.$gf.me && m.object === lastMessage.id);
      // if (readReceipts.length === 0) {
      //   // post a read receipt if none exists for this message already
      //   const readReceipt = {
      //     type: 'Read',
      //     object: lastMessage.id,
      //     context: [lastMessage.id]
      //   };
      //   // set to private if not showing read receipts
      //   if (!this.showReadReceipts) readReceipt.bto = [];
      //   this.$gf.post(readReceipt);
      // } 

      // check if already added this username
      if (this.actorsToUsernames[lastMessage.actor]) return;
      this.resolver.actorToUsername(lastMessage.actor).then(

        (res) => this.actorsToUsernames[lastMessage.actor] = res
      )
    },

    messages(newMessages) {
      // reset scroll
      waitForElm(".message-list").then(messageList =>
        messageList.scrollTop = 0
      );
    }
  },

  computed: {

    readReceipts() {
      let readReceipts = this.messagesRaw.filter(m => 
        m.type === 'Read'
      );
      return readReceipts;
    },

    messagesWithImages() {
      let messages = this.messagesRaw.filter(m => 
        m.attachment &&
        m.attachment.type === "Image" &&
        typeof m.attachment.magnet ==='string'
      );
      return messages;
    },

    allMessages() {
      // get all messages with actors
      let messages = this.messagesRaw.filter(m => m.actor);
      return messages;
    },

    messages() {
      let messages = this.messagesRaw
        // Filter the "raw" messages for data
        // that is appropriate for our application
        // https://www.w3.org/TR/activitystreams-vocabulary/#dfn-note
        .filter(m=>
          // Does the message have a type property?
          m.type         &&
          // Is the value of that property 'Note'?
          m.type=='Note' &&
          // Does the message have a content property?
          m.content      &&
          // Is that property a string?
          typeof m.content=='string') 

      // Do some more filtering for private messaging
      if (this.privateMessaging) {
        messages = messages.filter(m=>
          // Is the message private?
          m.bto &&
          // Is the message to exactly one person?
          m.bto.length == 1 &&
          (
            // Is the message to the recipient and from me?
            (m.actor == this.$gf.me && m.bto[0] == this.recipient) ||
            // Or is the message to me and from the recipient?
            (m.actor == this.recipient && m.bto[0] == this.$gf.me)
          ))
      }

      return messages
        // Sort the messages with the
        // most recently created ones first
        .sort((m1, m2)=> new Date(m2.published) - new Date(m1.published))
        // Only show the 10 most recent ones
        // .slice(0,10)
    },

    allThreads() {
      // get all notes that start a thread
      let threadBases = new Set();
      const messageIds = this.messages.map(m => m.id);
      this.messages.forEach(m => {
        // make sure message still exists and add if so add it to all threads set
        if (messageIds.includes(m.inReplyTo)) threadBases.add(m.inReplyTo);
      });
      return Array.from(threadBases);
    },
  },

  methods: {

    getThreadContent(threadId) {
      // find message and return its content
      const thread = this.messages.filter(m => m.id == threadId)[0];
      return thread ? thread.content : "error?";
    },

    goToThread(thread) {
      this.viewingThreads = true;
      this.currentThread = thread;
    },

    getMessages() {
      // if not in threads, return regular messages without replies
      if (!this.viewingThreads) return this.messages.filter(m => !m.inReplyTo);
      // figure out what thread we are viewing
      const messagesInThread = this.messages.filter(m => 
        // thread base
        m.id === this.currentThread ||
        // reply to thread base
        m.inReplyTo === this.currentThread
      );
      return messagesInThread;
    },

    viewThreads() {
      this.viewingThreads = !this.viewingThreads;
      if (!this.viewingThreads) {
        this.currentThread = undefined;
      }
    },

    messageRead(messageid) {
      // true if > 0 read indicators for this messageid from someone else and false otherwise
      return this.readReceipts.filter(m => m.context === messageid && m.actor !== this.$gf.me).length > 0;
    },

    resetImageContents() {
      // reset image contents
      this.file = undefined;
      document.querySelector("input[type='file']").value = "";
    },

    onImageAttachment(event) {
      const file = event.target.files[0];
      this.file = file;
    },

    changeTab(selection) {
      // no longer viewing threads
      this.viewingThreads = false;
      this.currentThread = undefined;
      // remove 'active' class from all other tabs
      document.querySelectorAll('.tab.active').forEach(it => it.classList.remove('active'));
      // set private messaging to correct value
      this.privateMessaging = (selection === 'pm');
      // add 'active' class to current tab
      document.getElementById(selection).classList.add('active');
    },

    formatTime(datetime) {
      const date = new Date(datetime);
      return date.toLocaleString();
    },

    getUsernameFromActorId(actorId) {
      return this.actorsToUsernames[actorId] ?? 'unknown';
    },

    async getActorIdFromUsername() {
      // initiate loading
      document.getElementById("search-username-loader").classList.add("loading");
      const recipientUsername = document.getElementById("recipientUsername").value;
      await this.resolver.usernameToActor(recipientUsername)
        .then((res) => {
          document.getElementById("search-username-loader").classList.remove("loading");
          if (res) {
            this.showActorIdError = false;
            this.recipient = res;
          } else {
            // let user know the actor ID could not be found
            this.showActorIdError = true;
            document.querySelectorAll("#usernameInput input").forEach(element => {
              // https://stackoverflow.com/questions/44846614/trigger-css-animations-in-javascript
              element.classList.remove("error");
              element.offsetWidth;
            });
            document.querySelectorAll("#usernameInput input").forEach(element => element.classList.add("error"));
          }
        });
    },

    async requestUsername() {
      // initiate loading
      document.getElementById("request-username-loader").classList.add("loading");
      const requestedUsername = document.getElementById("username").value;
      await this.resolver.requestUsername(requestedUsername)
        .then((res) => {
          if (res === "success") {
            this.showRequestError = false;
            this.username = requestedUsername;
            this.actorsToUsernames[this.$gf.me] = requestedUsername;
          }
          document.getElementById("request-username-loader").classList.remove("loading");
        })
        .catch(() => {
          document.getElementById("request-username-loader").classList.remove("loading");
          // let user know the username is already taken
          this.showRequestError = true;
          document.querySelectorAll("#requestUsername input").forEach(element => {
            // https://stackoverflow.com/questions/44846614/trigger-css-animations-in-javascript
            element.classList.remove("error");
            element.offsetWidth;
          });
          document.querySelectorAll("#requestUsername input").forEach(element => element.classList.add("error"));
        });
    },

    async sendMessage() {
      let message;
      if (this.file) {
        const magnet = await this.$gf.media.store(this.file);
        message = {
          type: 'Note',
          content: this.messageText,
          attachment: {
            type: 'Image',
            magnet: magnet
          }
        }
        this.resetImageContents();
      } else {
        message = {
          type: 'Note',
          content: this.messageText
        }
      }

      // The context field declares which
      // channel(s) the object is posted in
      // You can post in more than one if you want!
      // The bto field makes messages private
      if (this.privateMessaging) {
        message.bto = [this.recipient]
        message.context = [this.$gf.me, this.recipient]
      } else {
        message.context = [this.channel]
      }

      // add inReplyTo if sending message in thread
      if (this.currentThread) {
        message.inReplyTo = this.currentThread;
      }

      // Send!
      this.$gf.post(message)

      // remove message content from message box
      this.messageText = "";
    },

    async removeMessage(message) {
      // remove all replies to that message if it is the base of the message
      if (this.currentThread === message.id) {
        this.messages.filter(m => m.inReplyTo === message.id).forEach(m => async () => await this.$gf.remove(m));
        // go back to main chat
        this.viewThreads();
      }
      await this.$gf.remove(message);
    },

    startEditMessage(message) {
      // Mark which message we're editing
      this.editID = message.id
      // And copy over it's existing text
      this.editText = message.content
    },

    saveEditMessage(message) {
      // Save the text (which will automatically
      // sync with the server)
      message.content = this.editText
      // And clear the edit mark
      this.editID = ''
    },

    startThread(messageid) {
      // change view to a new thread starting at this message
      this.currentThread = messageid;
      this.viewingThreads = true;
    },
  }
}

const Name = {
  props: ['actor', 'editable', 'username'],

  setup(props) {
    // Get a collection of all objects associated with the actor
    const { actor } = Vue.toRefs(props)
    const $gf = Vue.inject('graffiti')
    return $gf.useObjects([actor])
  },

  computed: {
    profile() {
      return this.objects
        // Filter the raw objects for profile data
        // https://www.w3.org/TR/activitystreams-vocabulary/#dfn-profile
        .filter(m=>
          // Does the message have a type property?
          m.type &&
          // Is the value of that property 'Profile'?
          m.type=='Profile' &&
          // Does the message have a name property?
          m.name &&
          // Is that property a string?
          typeof m.name=='string')
        // Choose the most recent one or null if none exists
        .reduce((prev, curr)=> !prev || curr.published > prev.published? curr : prev, null)
    }
  },

  data() {
    return {
      editing: false,
      editText: ''
    }
  },

  methods: {

    editName() {
      this.editing = true
      // If we already have a profile,
      // initialize the edit text to our existing name
      this.editText = this.profile? this.profile.name : this.editText
    },

    saveName() {
      if (this.profile) {
        // If we already have a profile, just change the name
        // (this will sync automatically)
        this.profile.name = this.editText
      } else {
        // Otherwise create a profile
        this.$gf.post({
          type: 'Profile',
          name: this.editText
        })
      }

      // Exit the editing state
      this.editing = false
    }
  },

  template: '#name'
}

const Profile = {
  props: ['actor', 'editable'],

  setup(props) {
    // Get a collection of all objects associated with the actor
    const { actor } = Vue.toRefs(props)
    const $gf = Vue.inject('graffiti')
    return $gf.useObjects([actor])
  },

  computed: {
    profile() {
      return this.objects
        // Filter the raw objects for profile data
        // https://www.w3.org/TR/activitystreams-vocabulary/#dfn-profile
        .filter(m=>
          // Does the message have a type property?
          m.type &&
          // Is the value of that property 'Profile'?
          m.type=='Profile' &&
          // Does the message have an icon with a magnet property?
          ((m.icon && m.icon.magnet) || (m.image && m.image.magnet)))
        // Choose the most recent one or null if none exists
        .reduce((prev, curr)=> !prev || curr.published > prev.published? curr : prev, null)
    },

  },

  data() {
    return {
      placeholderPic : "img/blank-profile-photo.jpeg",
      editing: false,
      profilePicWhileEditing: undefined,
      profilePicTemp: undefined
    }
  },

  methods: {

    // returns link that should be used in profile image src attribute
    // async profilePic() {
    //   if (!this.profile) return this.placeholderPic;
    //   const magnet = (this.profile.icon) ? this.profile.icon.magnet : this.profile.image.magnet;
    //   const blob = await this.$gf.media.fetch(magnet);
    //   return URL.createObjectURL(blob);
    // },

    profilePic() {
      return this.placeholderPic;
    },

    async editProfile() {
      this.editing = true
      // show a profile pic while editing (either the old profile pic or a placeholder image)
      if (this.profile) {
        const magnet = (this.profile.icon) ? this.profile.icon.magnet : this.profile.image.magnet;
        this.profilePicWhileEditing = await this.$gf.media.fetch(magnet);
      } else {
        this.profilePicWhileEditing = this.placeholderPic;
      }
    },

    async saveProfilePic() {
      if (this.profile) {
        // If we already have a profile, just change the magnet
        if (this.profile.icon) {
          this.profile.icon.magnet = await this.$gf.media.store(this.profilePicTemp);
        }
      } else {
        // Otherwise create a profile
        const magnet = await this.$gf.media.store(this.profilePicTemp);
        const post = {
          type: 'Profile',
          icon: {
            type: 'Image',
            magnet: magnet
          }
        }
        await this.$gf.post(post); 
      }

      // Exit the editing state
      this.editing = false;
      this.profilePicTemp = undefined;
    },

    onProfileImageAttachment(event) {
      const profileImg = event.target.files[0];
      this.profilePicTemp = profileImg;
    },

  },

  template: '#profile'
}

const Like = {
  props: ["messageid"],

  setup(props) {
    const $gf = Vue.inject('graffiti')
    const messageID = Vue.toRef(props, 'messageid')
    const { objects: likesRaw } = $gf.useObjects([messageID])
    return { likesRaw }
  },

  computed: {

    myLikes() {
      // filter to get all my likes
      const mylikes = this.likesRaw.filter(
        it => it.type === "Like" && it.object === this.messageid && it.actor == this.$gf.me
      );
      return mylikes;
    },

    likes() {
      // filter to get all likes
      const likes = this.likesRaw.filter(
        it => it.type === "Like" && it.object === this.messageid
      );
      const allActors = new Set();
      // deduplicate likes from the same actor
      const deduplicatedLikes = [];
      for (const like of likes) {
        const actor = like.actorId;
        if (!allActors.has(actor)) {
          deduplicatedLikes.push(like);
          allActors.add(actor);
        }
      }
      return deduplicatedLikes;
    }
  },

  methods: {
    handleLike() {
      // check if you have already liked the message
      if (this.myLikes.length > 0) {
        // message has already been liked -> undo like
        this.$el.classList.remove("liked");
        this.undoLike();
      } else {
        // message has not already been liked -> like message
        this.$el.classList.add("liked");
        this.sendLike();
      }

    },

    sendLike() {
      const like = {
        type: 'Like',
        object: this.messageid,
        context: [this.messageid]
      }
      this.$gf.post(like);
    },

    undoLike() {
      // remove all of my likes on this post
      const myLikes = this.myLikes;
      myLikes.forEach(it => this.$gf.remove(it));
    }
  },

  template: '#like'
}

app.components = { Name, Like, Profile }
Vue.createApp(app)
   .use(GraffitiPlugin(Vue))
   .mount('#app')


// https://stackoverflow.com/questions/5525071/how-to-wait-until-an-element-exists
function waitForElm(selector) {
  return new Promise(resolve => {
      if (document.querySelector(selector)) {
          return resolve(document.querySelector(selector));
      }

      const observer = new MutationObserver(mutations => {
          if (document.querySelector(selector)) {
              resolve(document.querySelector(selector));
              observer.disconnect();
          }
      });

      observer.observe(document.body, {
          childList: true,
          subtree: true
      });
  });
}