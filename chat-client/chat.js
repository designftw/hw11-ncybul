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
    // const channel = Vue.ref('default')
    const channel = Vue.ref('nicoles channel')

    const viewState = Vue.ref("explore") // one of [explore, channel, pm] as of right now

    // pick the correct context based on the viewState (always choose classes context as well)
    const $gf = Vue.inject('graffiti')
    const context = Vue.computed(() => {
      if (viewState.value === 'channel') return [channel.value, 'classes'];
      if (viewState.value === 'pm') return [$gf.me, 'classes'];
      return ['classes']; // default is just classes context
    })

    // Initialize the collection of messages associated with the context
    const { objects: messagesRaw } = $gf.useObjects(context)
    return { channel, messagesRaw, viewState }
  },

  data() {
    // Initialize some more reactive variables
    return {
      messageText: '',
      editID: '',
      editText: '',
      recipient: '',
      showActorIdError: false,
      showUsernameError: false,
      username: undefined,
      showRequestError: false,
      actorsToUsernames: {},
      file: undefined,
      downloadedImages: {},
      showReadReceipts: true,
      viewingThreads: false,
      currentThread: undefined,
      currentThreadName: undefined,
      currentThreadBase: undefined,
      queryByUsername: "username",
      recipientActorId: undefined,
      recipientUsername: undefined,
      newGroupName: "",
      newThreadName: "",
      currentGroupName: undefined,
      showCreateGroupError: false,
      showSuccessMessage: false,
      waitingForRequest: false,
      editingThread: undefined,
      editingThreadText: undefined,
      filterClasses: false,
      searchInput: ''
    }
  },

  watch: {

    '$gf.me': async function(me) {
      this.username = await this.resolver.actorToUsername(me)
    },

    async messagesWithImages(messages) {
      for (const m of messages) {
        if (!(this.downloadedImages[m.attachment.magnet])) {
          this.downloadedImages[m.attachment.magnet] = "img/loader.svg"
          let blob
          try {
            blob = await this.$gf.media.fetch(m.attachment.magnet)
          } catch(e) {
            this.downloadedImages[m.attachment.magnet] = "error"
            continue
          }
          this.downloadedImages[m.attachment.magnet] = URL.createObjectURL(blob)
        }
      }
    },

    async allMessages(messages) {
      for (const m of messages) {
        if (!(m.actor in this.actorsToUsernames)) {
          this.actorsToUsernames[m.actor] = await this.resolver.actorToUsername(m.actor)
        }
        if (m.bto && m.bto.length && !(m.bto[0] in this.actorsToUsernames)) {
          this.actorsToUsernames[m.bto[0]] = await this.resolver.actorToUsername(m.bto[0])
        }
      }
    },

    messages(newMessages) {
      // reset scroll
      const messageList = document.querySelector(".message-list");
      if (messageList) messageList.scrollTop = 0;
    }
  },

  computed: {

    allJoins() {
      let joins = this.messagesRaw.filter(m => 
        m.type === 'Join' &&
        m.context.includes("classes")
      );
      return joins;
    },

    // return all classes that I have joined
    myJoinedClasses() {
      // find all join posts made by me
      let myJoins = this.messagesRaw.filter(m => 
        m.type === 'Join' &&
        m.context.includes("classes") &&
        m.actor === this.$gf.me
      );

      // find the uris of all the classes I have joined
      let uris = myJoins
        .reduce((accumulator, value) => accumulator.concat(value.context), [])
        .filter((context) => context !== 'classes'); // remove 'classes' context to leave just the URIs
      uris = [...new Set(uris)]; // deduplicate URIs

      // find Class objects with these uris
      const myClasses = this.classes.filter((c) => uris.includes(c.uri));
      return [...new Set(myClasses)]; // class names should be unique
    },

    classes() {
      let classes = this.messagesRaw.filter(m => 
        m.type === 'Class' &&
        m.name &&
        typeof m.name === 'string'
      );
      return classes;
    },

    filteredClasses() {
      let classes = this.messagesRaw.filter(m => 
        m.type === 'Class' &&
        m.name &&
        typeof m.name === 'string' &&
        m.name.includes(this.searchInput)
      );
      return classes;
    },

    readReceipts() {
      let readReceipts = this.messagesRaw.filter(m => 
        m.type === 'Read'
      );
      return readReceipts;
    },

    messagesWithImages() {
      let messages = this.messages.filter(m => 
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
      if (this.viewState === 'pm') {
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

    threads() {
      let threads = this.allMessages.filter((m) => 
        m.type === 'Thread' &&
        m.name !== undefined &&
        m.uri &&
        typeof m.uri=='string'
      );
      // also filter on recipient if private messaging
      if (this.viewState === 'pm') {
        // hack to avoid getting all threads that I am a part of
        if (this.recipient === this.$gf.me) {
          // filter out threads with contexts that include anybody but me
          threads = threads.filter(t => t.context.filter(c => c !== this.$gf.me).length === 0)
        } else {
          threads = threads.filter(t => t.context.includes(this.recipient));
        }
      }
      return threads;
    },

    members() {
      // inside a channel
      if (this.viewState === 'channel') {
        // find all people who have joined a class
        let allJoins = this.messagesRaw.filter(m => 
          m.type === 'Join' &&
          m.context.includes(`class://mit:${this.currentGroupName}`)
        );
        let members = [...new Set(allJoins.map(j => j.actor))];
        const memberUsernames = [];
        for (const member of members) {
          const username = this.actorsToUsernames[member] ?? 'unknown user';
          memberUsernames.push(username);
        }
        return memberUsernames;
      }
      // private messaging (no members)
      return [];
    }
  },

  methods: {

    getTrimmedThread(threadName) {
      const maxLength = 30;
      if (threadName.length > maxLength) {
        return `${threadName.substring(0, maxLength)}...`;
      }
      return threadName;
    },

    openMembersDialog() {
      const dialog = document.getElementById("members-dialog");
      dialog.showModal(); 
    },

    closeMembersDialog() {
      const dialog = document.getElementById("members-dialog");
      dialog.close();
    },

    searchGroups() {
      this.filterClasses = true;
    },

    cancelSearch() {
      this.filterClasses = false;
      this.searchInput = "";
    },

    startEditThread(thread) {
      this.editingThread = thread.uri;
      this.editingThreadText = thread.name;
    },

    saveEditThread(thread) {
      thread.name = this.editingThreadText;
      this.editingThread = false;
      this.editingThreadText = undefined;
    },

    cancelEditThread() {
      this.editingThread = false;
      this.editingThreadText = undefined;
    },

    deleteThread(thread) {
      const confirmDelete = confirm(`Are you sure you would like to delete the thread '${thread.name}'? This cannot be undone.`);
      if (!confirmDelete) return;
      // delete all messages belonging to that thread
      const messagesInThread = this.messages.filter(m => 
        // base of message that has been deleted 
        m.deletedBase ||
        // reply to thread base
        m.inReplyTo === thread.uri
      );
      this.$gf.remove(thread);
      messagesInThread.forEach(m =>
        this.$gf.remove(m)
      );
    },

    async createNewThread() {
      // create a new URI
      this.currentThread = `thread://:${crypto.randomUUID()}`;
      this.currentThreadName = this.newThreadName;
      this.currentThreadBase = undefined; // threads that get created from scratch do not have a base

      const thread = {
        type: 'Thread',
        base: this.currentThreadBase,
        name: this.currentThreadName,
        uri: this.currentThread,
        context: this.viewState === 'pm' ? [this.$gf.me, this.recipient] : [this.channel]
      }
      this.closeThreadDialog();
      await this.$gf.post(thread);
    },

    clearThreadInfo() {
      this.currentThread = undefined;
      this.currentThreadName = undefined;
      this.currentThreadBase = undefined;
    },

    openThreadDialog() {
      const dialog = document.getElementById("create-new-thread-dialog");
      dialog.showModal();
    },

    closeThreadDialog() {
      // clear all input fields
      this.newThreadName = "";
      const dialog = document.getElementById("create-new-thread-dialog");
      dialog.close();
    },

    joinedClassAlready(groupName) {
      return this.myJoinedClasses.map(it => it.name).filter(it => it === groupName).length > 0;
    },

    goToGroup(group) {
      this.viewState = "channel";
      this.viewingThreads = false;
      this.clearThreadInfo();
      this.channel = group.uri;
      this.currentGroupName = group.name;
    },

    goToPm() {
      this.viewState = "pm";
      this.channel = undefined;
      this.currentGroupName = undefined;
      this.viewingThreads = false;
      this.clearThreadInfo();
    },

    goToExploreGroups() {
      this.viewState = "explore";
      this.viewingThreads = false;
      this.clearThreadInfo();
      this.currentGroupName = undefined;
      this.searchInput = '';
    },

    openUsernameDialog() {
      const dialog = document.getElementById("request-username-dialog");
      dialog.showModal(); 
    },

    closeUsernameDialog() {
      document.getElementById("username").value = "";
      const dialog = document.getElementById("request-username-dialog");
      dialog.close();
      this.showRequestError = false;
      this.showSuccessMessage = false;
    },

    openDialog() {
      const dialog = document.getElementById("create-new-group-dialog");
      dialog.showModal(); 
    },

    closeDialog() {
      // clear all input fields
      this.newGroupName = "";
      const dialog = document.getElementById("create-new-group-dialog");
      dialog.close();
      this.showCreateGroupError = false;
    },

    async createGroup() {
      // check that this class name is not already in use
      if (this.classes.map(c => c.name).includes(this.newGroupName)) {
        this.showCreateGroupError = true;
        return;
      };

      const group = {
        type: 'Class',
        name: this.newGroupName,
        uri: `class://mit:${this.newGroupName}`,
        context: ['classes'] // classes context for now
      };

      this.showCreateGroupError = false;

      await this.$gf.post(group); // post new class
      this.closeDialog();
    },

    async deleteGroup(groupId) {
      const classToRemove = this.classes.find(c => c.id === groupId);
      const confirmDelete = confirm(`Are you sure you would like to delete the '${classToRemove.name}' group chat? This cannot be undone.`);
      if (!confirmDelete) return;
      // remove class with this id
      const removedUri = classToRemove.uri;
      await this.$gf.remove(classToRemove);
      // remove all objects posted in this context
      this.allMessages.filter(m => m.context.includes(removedUri)).forEach(async (it) => {
        this.$gf.remove(it);
      });
    },

    async joinGroup(groupId) {
      // find class and join it
      const group = this.classes.find(c => c.id === groupId);
      const post = {
        type: 'Join',
        context: ['classes', group.uri] // classes context and class group uri
      }; 
      await this.$gf.post(post); // post
    },

    async leaveGroup(group) {
      const confirmLeave = confirm(`Are you sure you would like to leave the '${group.name}' group chat?`);
      if (!confirmLeave) return;
      // remove any join posts to this group
      let myJoins = this.messagesRaw.filter(m => 
        m.type === 'Join' &&
        m.context.includes(group.uri) &&
        m.actor === this.$gf.me
      );
      myJoins.forEach(async (j) => await this.$gf.remove(j));
    },

    imageError(magnet) {
      return this.downloadedImages[magnet] === 'error';
    },

    messageStartsThread(messageId) {
      return this.threads.map(t => t.base).filter(base => base === messageId).length > 0;
    },

    getThreadContent(threadId) {
      // find message and return its content
      const thread = this.messages.filter(m => m.id == threadId)[0];
      return thread ? thread.content : "";
    },

    findThreadFromUri(uri) {
      return this.threads.find(t => t.uri === uri); 
    },

    findThreadFromBase(base) {
      return this.threads.find(t => t.base === base); 
    },

    goToThread(threadUri) {
      this.viewingThreads = true;
      this.currentThread = threadUri;
      this.currentThreadName = this.findThreadFromUri(threadUri).name;
      this.currentThreadBase = this.findThreadFromUri(threadUri).base;
    },

    goToThreadFromBase(threadBase) {
      this.viewingThreads = true;
      const thread = this.findThreadFromBase(threadBase);
      this.currentThread = thread.uri;
      this.currentThreadName = thread.name;
      this.currentThreadBase = thread.base;
    },

    getMessages() {

      // if not in threads, return regular messages without replies
      if (!this.viewingThreads) {
        // if not in threads, return regular messages without replies
        let messagesToReturn = this.messages.filter(m => !m.inReplyTo);
        if (this.viewState === "channel") messagesToReturn = messagesToReturn.filter(m => m.context.includes(this.channel));

        // for each message being returned, add a read receipt to it if none exists already
        messagesToReturn.forEach(m => {
          const readReceipts = this.readReceipts.filter(r => r.actor === this.$gf.me && r.object === m.id);
          if (readReceipts.length === 0) {
            // post a read receipt if none exists for this message already
            const readReceipt = {
              type: 'Read',
              object: m.id
            };
            // set to private if not showing read receipts
            if (!this.showReadReceipts) readReceipt.bto = [];
            // set context to this message id + channel or private messaging contexts
            if (this.viewState === 'pm') {
              readReceipt.context = [m.id, this.$gf.me, this.recipient]
            } else {
              readReceipt.context = [m.id, this.channel]
            }
            this.$gf.post(readReceipt);
          } 
        });

        return messagesToReturn;
      }
      // figure out what thread we are viewing
      const messagesInThread = this.messages.filter(m => 
        // thread base
        m.id === this.currentThreadBase ||
        // reply to thread base
        m.inReplyTo === this.currentThread
      );
      return messagesInThread;
    },

    viewThreads() {
      this.viewingThreads = !this.viewingThreads;
      if (!this.viewingThreads) {
        this.clearThreadInfo();
      }
    },

    returnToThreads() {
      this.clearThreadInfo();
    },

    messageRead(messageid) {
      // true if > 0 read indicators for this messageid from someone else and false otherwise
      return this.readReceipts.filter(m => m.object === messageid && m.actor !== this.$gf.me).length > 0;
    },

    getNumberReaders(messageid) {
      // create set of actors that have read this message
      const uniqueReaders = new Set(this.readReceipts.filter(m => m.object === messageid && m.actor !== this.$gf.me).map(m => m.actor));
      return uniqueReaders.size;
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

    formatTime(datetime) {
      const date = new Date(datetime);
      return date.toLocaleString();
    },

    getUsernameFromActorId(actorId) {
      return this.actorsToUsernames[actorId] ?? 'unknown';
    },

    async getActorId() {
      if(this.queryByUsername !== "username") {
        // clear out previous username input
        this.recipientUsername = undefined;
        this.showUsernameError = false;
        const recipientActorId = this.recipientActorId;
        const regex =  /^graffitiactor:\/\/[0-9a-f]{64}$/;
        if (regex.test(recipientActorId)) {
          // actor ID is formatted correctly
          this.showActorIdError = false;
          this.recipient = recipientActorId;
        } else {
          // actor ID is not formatted correctly
          this.showActorIdError = true;
          document.querySelectorAll("#usernameInput input").forEach(element => {
            // https://stackoverflow.com/questions/44846614/trigger-css-animations-in-javascript
            element.classList.remove("error");
            element.offsetWidth;
          });
          document.querySelectorAll("#usernameInput input").forEach(element => element.classList.add("error"));
          // reset recipient
          this.recipient = undefined;
          // switch to no longer view threads
          if (this.viewingThreads) this.viewThreads();
        }
      } else {
        // clear out previous actor ID input
        this.recipientActorId = undefined;
        this.showActorIdError = false;
        // initiate loading
        document.getElementById("search-username-loader").classList.add("loading");
        const recipientUsername = this.recipientUsername;
        await this.resolver.usernameToActor(recipientUsername)
          .then((res) => {
            document.getElementById("search-username-loader").classList.remove("loading");
            if (res) {
              this.showUsernameError = false;
              this.recipient = res;
            } else {
              // let user know the actor ID could not be found
              this.showUsernameError = true;
              document.querySelectorAll("#usernameInput input").forEach(element => {
                // https://stackoverflow.com/questions/44846614/trigger-css-animations-in-javascript
                element.classList.remove("error");
                element.offsetWidth;
              });
              document.querySelectorAll("#usernameInput input").forEach(element => element.classList.add("error"));
              // reset recipient
              this.recipient = undefined;
              // switch to no longer view threads
              if (this.viewingThreads) this.viewThreads();
            }
          });
      }
    },

    async requestUsername() {
      // initiate loading
      this.waitingForRequest = true;
      const requestedUsername = document.getElementById("username").value;
      await this.resolver.requestUsername(requestedUsername)
        .then((res) => {
          if (res === "success") {
            this.showRequestError = false;
            this.username = requestedUsername;
            this.actorsToUsernames[this.$gf.me] = requestedUsername;
            this.showSuccessMessage = true;
          }
          this.waitingForRequest = false;
          document.getElementById("username").value = "";
        })
        .catch(() => {
          this.waitingForRequest = false;
          // let user know the username is already taken
          this.showRequestError = true;
          this.showSuccessMessage = false;
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
      if (this.viewState === 'pm') {
        message.bto = [this.recipient]
        message.context = [this.$gf.me, this.recipient]
      } else {
        message.context = [this.channel, 'classes']
      }

      if (this.currentThread) {
        // create a new thread if one does not already exist
        if (!this.threads.map(t => t.uri).includes(this.currentThread)) {
          const thread = {
            type: 'Thread',
            base: this.currentThreadBase,
            name: this.currentThreadName,
            uri: this.currentThread,
            context: this.viewState === 'pm' ? [this.$gf.me, this.recipient] : [this.channel]
          }
          await this.$gf.post(thread);
        }
        // add inReplyTo field linked to thread uri
        message.inReplyTo = this.currentThread;
      }

      // Send!
      this.$gf.post(message)

      // remove message content from message box
      this.messageText = "";
    },

    async removeMessage(message) {
      // check if this message starts a thread --> if so, mark it as deleted
      if (this.messageStartsThread(message.id)) {
        message.content = "[message deleted]";
        message.deletedBase = true;
      } else {
        await this.$gf.remove(message);
      }
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

    cancelEditMessage() {
      this.editID = '';
      this.editText = '';
    },

    startThread(messageid) {
      // change view to a new thread starting at this message
      this.viewingThreads = true;
      // create a new URI
      this.currentThread = `thread://:${crypto.randomUUID()}`;
      this.currentThreadName = this.getThreadContent(messageid);
      this.currentThreadBase = messageid;
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

  watch: {
    async profile(newProfile) {
      if (!newProfile) return;
      // fetch new profile pic
      const magnet = (newProfile.icon) ? newProfile.icon.magnet : newProfile.image.magnet;
      this.$gf.media.fetch(magnet).then((blob) => {
        this.profilePic = URL.createObjectURL(blob);
      }).catch(() => this.profilePic = this.placeholder);
    }
  },

  data() {
    return {
      placeholder: "img/blank-profile-photo.jpeg",
      editing: false,
      profilePic: "img/blank-profile-photo.jpeg",
      profilePicTemp: undefined
    }
  },

  methods: {

    cancelEdit() {
      // Exit the editing state
      this.editing = false;
      this.profilePicTemp = undefined;
    },

    async editProfile() {
      this.editing = true
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
      this.cancelEdit();
    },

    onProfileImageAttachment(event) {
      this.profilePicTemp = event.target.files[0];
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
        const actor = like.actor;
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
        this.undoLike();
      } else {
        // message has not already been liked -> like message
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

const ReadReceipt = {
  props: ["messageid", "side"],

  // Import resolver
  created() {
    this.resolver = new Resolver(this.$gf)
  },

  setup(props) {
    const $gf = Vue.inject('graffiti')
    const messageID = Vue.toRef(props, 'messageid')
    const { objects: messagesRaw } = $gf.useObjects([messageID])
    return { messagesRaw }
  },

  computed: {

    readReceipts() {
      // filter to get all likes
      const readReceipts = this.messagesRaw.filter(
        m => m.type === "Read" && m.object === this.messageid && m.actor !== this.$gf.me
      );
      const allActors = new Set();
      // deduplicate reads from the same actor
      const deduplicatedReads = [];
      for (const read of readReceipts) {
        const actor = read.actor;
        if (!allActors.has(actor)) {
          deduplicatedReads.push(read);
          allActors.add(actor);
        }
      }
      return deduplicatedReads;
    }
  },

  watch: {
    async readReceipts(newReadReceipts) {
      for (const newReadReceipt of newReadReceipts) {
        if (!newReadReceipt || this.readersListActorIds.has(newReadReceipt.actor)) continue;
        // fetch username for this actor and add to readers list
        this.resolver.actorToUsername(newReadReceipt.actor).then((res) => {
            if (res) {
              this.readersList.push(res);
              this.readersListActorIds.add(newReadReceipt.actor);
            }
          }
        )
      }
    }
  },

  data() {
    return {
      readersListActorIds: new Set([]), // save these to check for quick membership in watcher
      readersList: []
    }
  },

  methods: {

    getReaders() {
      if (this.readersList.length === 0) return "No readers with usernames to display";
      if (this.readersList.length <= 3) {
        return "Includes Username(s): " + this.readersList.join(", "); 
      }
      const firstThree = this.readersList.slice(0,3).join(", ");
      const readerList = "Includes Username(s): " + firstThree;
      return (this.readersList.length === 4) ? readerList + " and 1 other": readerList + ` and ${this.readersList.length - 3} others`;
    },

    readByOthers() {
      return this.readReceipts.length > 0;
    },

    getNumReads() {
      return this.readReceipts.length;
    }

  },

  template: '#read-receipt'
}

app.components = { Name, Like, Profile, ReadReceipt }
Vue.createApp(app)
   .use(GraffitiPlugin(Vue))
   .mount('#app')