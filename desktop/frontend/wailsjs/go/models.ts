export namespace main {
	
	export class JoinRequest {
	    key: string;
	    name: string;
	
	    static createFrom(source: any = {}) {
	        return new JoinRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.key = source["key"];
	        this.name = source["name"];
	    }
	}
	export class MeetingSession {
	    room: string;
	    key: string;
	    inviteUrl: string;
	    token: string;
	    serverUrl: string;
	    isHost: boolean;
	    displayName: string;
	
	    static createFrom(source: any = {}) {
	        return new MeetingSession(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.room = source["room"];
	        this.key = source["key"];
	        this.inviteUrl = source["inviteUrl"];
	        this.token = source["token"];
	        this.serverUrl = source["serverUrl"];
	        this.isHost = source["isHost"];
	        this.displayName = source["displayName"];
	    }
	}

}

