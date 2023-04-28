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
      actorsToUsernames: {}
    }
  },

  watch: {
    async allMessages(newMessages) {
      const lastMessage = newMessages.pop();
      // check if already added this username
      if (lastMessage === undefined || this.actorsToUsernames[lastMessage.actor]) return;
      this.resolver.actorToUsername(lastMessage.actor).then(

        (res) => this.actorsToUsernames[lastMessage.actor] = res
      )
    },

    messages(newMessages) {
      // reset scroll
      const messageList = document.querySelector(".message-list");
      messageList.scrollTop = 0;
    }
  },

  computed: {

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
  },

  methods: {

    changeTab(selection) {
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

    sendMessage() {
      const message = {
        type: 'Note',
        content: this.messageText,
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

      // Send!
      this.$gf.post(message)

      // remove message content from message box
      this.messageText = "";
    },

    removeMessage(message) {
      this.$gf.remove(message)
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
    }
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

app.components = { Name }
Vue.createApp(app)
   .use(GraffitiPlugin(Vue))
   .mount('#app')
