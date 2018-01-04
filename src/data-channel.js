/**
 * Created by xieting on 2018/1/4.
 */

import SimplePeer from 'simple-peer';
import EventEmitter from 'events';
import {defaultP2PConfig as config} from './config';

class DataChannel extends EventEmitter {
    constructor(channelId, isInitiator) {
        super();

        this.channelId = channelId;
        this.connected = false;
        this._datachannel = new SimplePeer({ initiator: isInitiator, objectMode: true});
        this.isReceiver = isInitiator;                 //主动发起连接的为数据接受者，用于标识本节点的类型
        this._init(this._datachannel);
    }

    _init(datachannel) {

        datachannel.on('error', (err) => { console.log('datachannel error', err); });

        datachannel.on('signal', data => {
            // console.log('SIGNAL', JSON.stringify(data));
            this.emit('signal', data);
        });

        datachannel.once('connect', () => {
            console.log('datachannel CONNECTED to ' + this.channelId);
            this.emit('open');
            // datachannel.send(JSON.stringify({'whatever': Math.random()}));
            if (this.isReceiver) {
                this.keepAliveInterval = window.setInterval(() => {                      //数据接收者每隔一段时间发送keep-alive信息
                    let msg = {
                        event: 'KEEPALIVE'
                    };
                    datachannel.send(JSON.stringify(msg));
                    this.keepAliveAckTimeout = window.setTimeout(this._handleKeepAliveAckTimeout.bind(this),
                        config.dcKeepAliveAckTimeout*1000);
                }, config.dcKeepAliveInterval*1000);
            }
        });

        datachannel.on('data', data => {
            if (typeof data === 'string') {
                console.log('datachannel receive string: ' + data);

                let msg = JSON.parse(data);
                let event = msg.event;
                switch (event) {
                    case 'KEEPALIVE':
                        this._handleKeepAlive();
                        break;
                    case 'KEEPALIVE-ACK':
                        this._handleKeepAliveAck();
                        break;
                    case 'BINARY':

                        break;
                    case 'REQUEST':

                        break;
                    case 'LACK':
                        this.emit('datanotfound', msg);
                        break;
                    case 'CLOSE':
                        this.emit('close');
                        break;
                    default:

                }
            }


        });

        datachannel.once('close', () => {

        });
    }

    receiveSignal(data) {
        console.log('datachannel receive siganl ' + JSON.stringify(data));
        this._datachannel.signal(data);
    }

    destroy() {
        window.clearInterval(this.keepAliveInterval);
        this.keepAliveInterval = null;
        window.clearTimeout(this.keepAliveAckTimeout);
        this.keepAliveAckTimeout = null;
        this._datachannel.removeAllListeners();
        this.removeAllListeners();
        this._datachannel.destroy();
    }

    _handleKeepAlive() {
        let msg = {
            event: 'KEEPALIVE-ACK'
        };
        this._datachannel.send(JSON.stringify(msg));
    }

    _handleKeepAliveAck() {
        window.clearTimeout(this.keepAliveAckTimeout);
    }

    _handleKeepAliveAckTimeout() {
        console.warn('KeepAliveAckTimeout');
        this.emit('error');
    }
}

export default DataChannel;