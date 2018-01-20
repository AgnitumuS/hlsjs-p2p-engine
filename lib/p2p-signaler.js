/**
 * Created by xieting on 2018/1/3.
 */

/*
TODO:
 */

import EventEmitter from 'events';
import Events from './events';
import DataChannel from './data-channel';
import P2PScheduler from './p2p-scheduler';
import ReconnectingWebSocket from 'reconnecting-websocket';

// const log = console.log;

export default class P2PSignaler extends EventEmitter {
    constructor(channel, config, info) {
        super();

        this.config = config;
        this.browserInfo = info;
        this.connected = false;
        this.channel = channel;                                  //频道
        this.scheduler = new P2PScheduler(config);
        this.DCMap = new Map();                                  //{key: channelId, value: DataChannnel}
        console.log('connecting to :' + config.websocketAddr);
        this.websocket = null;

        if (config.p2pEnabled) {
            this.websocket = this._initWebsocket(info);
        }



    }

    send(msg) {
        if (this.connected) {
            this.websocket.send(msg);
        }
    }

    stopP2P() {
        this.scheduler.clearAllStreamers();
        // let msg = {
        //     action: 'leave'
        // };
        // this.send(msg);
        this.websocket.close(1000, '', {keepClosed: true, fastClose: true});

    }

    resumeP2P() {
        if (!this.connected) {
            this.websocket = this._initWebsocket(this.browserInfo);
        }
    }

    _initWebsocket(info) {

        const wsOptions = {
            maxRetries: this.config.wsMaxRetries,
            minReconnectionDelay: this.config.wsReconnectInterval*1000

        };
        let websocket = new ReconnectingWebSocket(this.config.wsAddr, undefined, wsOptions);

        websocket.onopen = () => {
            console.log('websocket connection opened with channel: ' + this.channel);
            this.connected = true;

            //发送进入频道请求
            let msg = {
                action: 'enter',
                channel: this.channel
            };

            if (info) {
                msg = Object.assign(msg, info);
            }

            websocket.push(JSON.stringify(msg));
        };

        websocket.push = websocket.send;
        websocket.send = msg => {
            let msgStr = JSON.stringify(Object.assign({channel: this.channel}, msg));
            console.log("send to websocket is " + msgStr);
            websocket.push(msgStr);
        };
        websocket.onmessage = (e) => {
            console.log('websocket on msg: ' + e.data);
            let msg = JSON.parse(e.data);
            let action = msg.action;
            switch (action) {
                case 'signal':
                    console.log('start _handleSignal');
                    this._handleSignal(msg.from_peer_id, msg.data);
                    break;
                case 'connect':
                    console.log('start _handleConnect');
                    this._createDatachannel(msg.to_peer_id, true);
                    break;
                case 'disconnect':

                    break;
                case 'accept':
                    this.peerId = msg.peer_id;                              //获取本端Id
                    break;
                case 'reject':
                    this.stopP2P();
                    break;
                default:
                    console.log('websocket unknown action ' + action);

            }

        };
        websocket.onclose = () => {                                            //websocket断开时清除datachannel
            console.warn(`websocket closed`);
            this.connected = false;
            this.scheduler.clearAllStreamers();
            this.DCMap.clear();
        };
        return websocket;
    }

    _handleSignal(remotePeerId, data) {
        let datachannel = this.DCMap.get(remotePeerId);
        if (!datachannel) {                                               //收到子节点连接请求
            console.log(`receive child node connection request`);
            datachannel =  this._createDatachannel(remotePeerId, false);

        }
        datachannel.receiveSignal(data);
    }

    _createDatachannel(remotePeerId, isInitiator) {
        let datachannel = new DataChannel(this.peerId, remotePeerId, isInitiator, this.config);
        this.DCMap.set(remotePeerId, datachannel);                                  //将对等端Id作为键
        this._setupDC(datachannel);
        return datachannel;
    }

    _setupDC(datachannel) {
        datachannel.on('signal', data => {
            let msg = {
                action: 'signal',
                peer_id: this.peerId,
                to_peer_id: datachannel.remotePeerId,
                data: data
            };
            this.websocket.send(msg);
        })
            .once('error', () => {
                let msg = {
                    action: 'dc_failed',
                    dc_id: datachannel.channelId,
                };
                this.websocket.send(msg);
                console.log(`datachannel error ${datachannel.channelId}`);
                this.scheduler.deleteDataChannel(datachannel);
                this.DCMap.delete(datachannel.remotePeerId);
                datachannel.destroy();

            })
            .once(Events.DC_CLOSE, () => {

                console.log(`datachannel closed ${datachannel.channelId} `);
                let msg = {
                    action: 'dc_closed',
                    dc_id: datachannel.channelId,
                };
                this.websocket.send(msg);
            this.scheduler.deleteDataChannel(datachannel);
            this.DCMap.delete(datachannel.remotePeerId);
            datachannel.destroy();
        })
            .once(Events.DC_OPEN, () => {

                this.scheduler.addDataChannel(datachannel);
                if (datachannel.isReceiver) {                              //子节点发送已连接消息
                    let msg = {
                        action: 'dc_opened',
                        dc_id: datachannel.channelId,
                    };
                    this.websocket.send(msg);
                }
            })
    }

    destroy() {
        this.websocket.close();
        this.websocket = null;
    }
}