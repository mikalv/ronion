// Generated by LiveScript 1.5.0
/**
 * @package   Ronion
 * @author    Nazar Mokrynskyi <nazar@mokrynskyi.com>
 * @copyright Copyright (c) 2017, Nazar Mokrynskyi
 * @license   MIT License, see license.txt
 */
(function(){
  var asyncEventer, randombytes, COMMAND_CREATE_REQUEST, COMMAND_CREATE_RESPONSE, COMMAND_EXTEND_REQUEST, COMMAND_EXTEND_RESPONSE, COMMAND_DESTROY, COMMAND_DATA;
  asyncEventer = require('async-eventer');
  randombytes = require('randombytes');
  module.exports = Ronion;
  COMMAND_CREATE_REQUEST = 1;
  COMMAND_CREATE_RESPONSE = 2;
  COMMAND_EXTEND_REQUEST = 3;
  COMMAND_EXTEND_RESPONSE = 4;
  COMMAND_DESTROY = 5;
  COMMAND_DATA = 6;
  /**
   * @param {Uint8Array} array
   *
   * @return {number}
   */
  function uint_array_to_number(array){
    return array[0] * 256 + array[1];
  }
  /**
   * @param {number} number
   *
   * @return {Uint8Array}
   */
  function number_to_uint_array(number){
    var lsb, msb;
    lsb = number % 256;
    msb = (number - lsb) / 256;
    return Uint8Array.of(msb, lsb);
  }
  /**
   * @param {Uint8Array} packet
   *
   * @return {array} [version: number, segment_id: Uint8Array]
   */
  function parse_packet_header(packet){
    return [packet[0], packet.subarray(1, 2)];
  }
  /**
   * @param {Uint8Array} packet_data
   *
   * @return {number[]} [command, command_data_length]
   */
  function parse_packet_data_header(packet_data){
    return [packet_data[0], uint_array_to_number(packet_data.subarray(1, 3))];
  }
  /**
   * @param {Uint8Array} packet_data
   *
   * @return {array} [command: number, command_data: Uint8Array]
   */
  function parse_packet_data_plaintext(packet_data){
    var ref$, command, command_data_length;
    ref$ = parse_packet_data_header(packet_data), command = ref$[0], command_data_length = ref$[1];
    return [command, packet_data.slice(3, 3 + command_data_length)];
  }
  /**
   * @param {number}		packet_size
   * @param {number}		version
   * @param {Uint8Array}	segment_id
   * @param {number}		command
   * @param {Uint8Array}	command_data
   *
   * @return {Uint8Array}
   */
  function generate_packet_plaintext(packet_size, version, segment_id, command, command_data){
    var packet_data_header, packet_data;
    packet_data_header = generate_packet_data_header(command, command_data.length);
    packet_data = generate_packet_data(packet_data_header, command_data);
    return generate_packet(this._packet_size, this._version, segment_id, packet_data);
  }
  /**
   * @param {number}		packet_size
   * @param {number}		version
   * @param {Uint8Array}	segment_id
   * @param {Uint8Array}	packet_data
   *
   * @return {Uint8Array}
   */
  function generate_packet(packet_size, version, segment_id, packet_data){
    var x$, packet, bytes_written, random_bytes_padding_length;
    x$ = packet = new Uint8Array(packet_size);
    x$.set([version]);
    x$.set(segment_id, 1);
    x$.set(packet_data, 3);
    bytes_written = 3 + packet_data.length;
    random_bytes_padding_length = packet_size - bytes_written;
    if (random_bytes_padding_length) {
      packet.set(randombytes(random_bytes_padding_length), bytes_written);
    }
    return packet;
  }
  /**
   * @param {Uint8Array}	packet_data_header
   * @param {Uint8Array}	command_data
   *
   * @return {Uint8Array}
   */
  function generate_packet_data(packet_data_header, command_data){
    var x$;
    x$ = new Uint8Array(packet_data_header.length + command_data.length);
    x$.set(packet_data_header);
    x$.set(command_data, packet_data_header.length);
    return x$;
  }
  /**
   * @param {number}	command
   * @param {number}	command_data_length
   *
   * @return {Uint8Array}
   */
  function generate_packet_data_header(command, command_data_length){
    var x$;
    x$ = new Uint8Array(3);
    x$.set(command);
    x$.set(number_to_uint_array(command_data_length), 1);
    return x$;
  }
  /**
   * @param {Uint8Array}	address
   * @param {Uint8Array}	segment_id
   *
   * @return {string}
   */
  function compute_source_id(address, segment_id){
    return address.join('') + segment_id.join('');
  }
  /**
   * @constructor
   *
   * @param {number}	version			0..255
   * @param {number}	packet_size
   * @param {number}	address_length
   * @param {number}	mac_length
   */
  function Ronion(version, packet_size, address_length, mac_length){
    if (!(this instanceof Ronion)) {
      return new Ronion(version, packet_size, address_length, mac_length);
    }
    asyncEventer.call(this);
    this._version = version;
    this._packet_size = packet_size;
    this._address_length = address_length;
    this._mac_length = mac_length;
    this._established_segments = new Map;
    this._pending_extension_segments = new Map;
    this._pending_extensions = new Map;
    this._segments_forwarding_mapping = new Map;
  }
  Ronion.prototype = {
    /**
     * Must be called when new packet appear
     *
     * @param {Uint8Array}	address	Address (in application-specific format) where packet came from
     * @param {Uint8Array}	packet	Packet
     */
    process_packet: function(address, packet){
      var ref$, version, segment_id, source_id, packet_data;
      if (packet.length !== this._packet_size) {
        return;
      }
      ref$ = parse_packet_header(packet), version = ref$[0], segment_id = ref$[1];
      if (version !== this._version) {
        return;
      }
      source_id = compute_source_id(address, segment_id);
      packet_data = packet.subarray(3);
      if (this._established_segments.has(source_id)) {
        this._process_packet_data_encrypted(source_id, packet_data);
      } else {
        this._process_packet_data_plaintext(address, segment_id, packet_data);
      }
    }
    /**
     * Must be called when new segment is established with node that has specified address
     *
     * @param {Uint8Array}	address
     * @param {Uint8Array}	segment_id
     */,
    confirm_established_segment: function(address, segment_id){
      var source_id;
      source_id = compute_source_id(address, segment_id);
      this._established_segments.set(source_id, [address]);
    }
    /**
     * Must be called when new segment is established with node that has specified address
     *
     * @param {Uint8Array}	address		Node at which to start routing path
     * @param {Uint8Array}	segment_id	Same segment ID as in CREATE_REQUEST
     */,
    confirm_extended_path: function(address, segment_id){
      var source_id, next_node_address;
      source_id = compute_source_id(address, segment_id);
      next_node_address = this._pending_extensions.get(source_id);
      this._established_segments.get(source_id).push(next_node_address);
      this._pending_extensions['delete'](source_id);
    }
    /**
     * Must be called in order to start new routing path, sends CREATE_REQUEST
     *
     * @param {Uint8Array}	address			Node at which to start routing path
     * @param {Uint8Array}	command_data
     *
     * @return {Uint8Array} segment_id Generated segment ID that can be later used for routing path extension
     *
     * @throws {RangeError}
     */,
    create_request: function(address, command_data){
      var segment_id, packet;
      segment_id = this._generate_segment_id(address);
      packet = generate_packet_plaintext(packet_size, version, segment_id, COMMAND_CREATE_REQUEST, command_data);
      this.fire('send', {
        address: address,
        packet: packet
      });
      return segment_id;
    }
    /**
     * @param {Uint8Array} address
     *
     * @return {Uint8Array}
     */,
    _generate_segment_id: function(address){
      var i$, to$, i, segment_id, source_id;
      for (i$ = 0, to$ = Math.pow(2, 16); i$ < to$; ++i$) {
        i = i$;
        segment_id = number_to_uint_array(i);
        source_id = compute_source_id(address, segment_id);
        if (!this._established_segments.has(source_id) && !this._pending_extension_segments.has(source_id)) {
          return segment_id;
        }
      }
      throw new RangeError('Out of possible segment IDs');
    }
    /**
     * Must be called in order to respond to CREATE_RESPONSE
     *
     * @param {Uint8Array}	address			Node from which CREATE_REQUEST come from
     * @param {Uint8Array}	segment_id		Same segment ID as in CREATE_REQUEST
     * @param {Uint8Array}	command_data
     */,
    create_response: function(address, segment_id, command_data){
      var packet;
      packet = generate_packet_plaintext(packet_size, version, segment_id, COMMAND_CREATE_RESPONSE, command_data);
      this.fire('send', {
        address: address,
        packet: packet
      });
    }
    /**
     * Must be called in order to extend routing path by one more segment, sends EXTEND_REQUEST
     *
     * @param {Uint8Array}	address				Node at which routing path has started
     * @param {Uint8Array}	segment_id			Same segment ID as returned by CREATE_REQUEST
     * @param {Uint8Array}	next_node_address	Node to which routing path will be extended from current last node
     * @param {Uint8Array}	command_data
     *
     * @throws {ReferenceError}
     */,
    extend_request: function(address, segment_id, next_node_address, command_data){
      var source_id, target_address, packet_data_header, this$ = this;
      source_id = compute_source_id(address, segment_id);
      if (!this._established_segments.has(source_id)) {
        throw new ReferenceError('There is no such segment established');
      }
      target_address = this._established_segments.get(source_id).slice(-1)[0];
      packet_data_header = generate_packet_data_header(COMMAND_EXTEND_REQUEST, command_data.length);
      this._encrypt(address, segment_id, target_address, packet_data_header).then(function(packet_data_header_encrypted){
        var x$, command_data;
        x$ = command_data = new Uint8Array(next_node_address.length + command_data.length);
        x$.set(next_node_address);
        x$.set(command_data, next_node_address.length);
        this$._encrypt(address, segment_id, target_address, command_data).then(function(command_data_encrypted){
          var packet_data, packet;
          packet_data = generate_packet_data(packet_data_header_encrypted, command_data_encrypted);
          packet = generate_packet(this$._packet_size, this$._version, segment_id, packet_data);
          this$.fire('send', {
            address: address,
            packet: packet
          });
          this$._pending_extensions.set(source_id, next_node_address);
        });
      });
    }
    /**
     * @param {Uint8Array}	address
     * @param {Uint8Array}	segment_id
     * @param {Uint8Array}	command_data
     */,
    _extend_response: function(address, segment_id, command_data){
      var packet_data_header, this$ = this;
      packet_data_header = generate_packet_data_header(COMMAND_EXTEND_RESPONSE, command_data.length);
      this._encrypt(address, segment_id, address, packet_data_header).then(function(packet_data_header_encrypted){
        this$._encrypt(address, segment_id, address, command_data).then(function(command_data_encrypted){
          var packet_data, packet;
          packet_data = generate_packet_data(packet_data_header_encrypted, command_data_encrypted);
          packet = generate_packet(this$._packet_size, this$._version, segment_id, packet_data);
          this$.fire('send', {
            address: address,
            packet: packet
          });
        });
      });
    }
    /**
     * @param {Uint8Array}	address
     * @param {Uint8Array}	segment_id
     * @param {Uint8Array}	packet_data
     */,
    _process_packet_data_plaintext: function(address, segment_id, packet_data){
      var ref$, command, command_data, source_id, original_source;
      ref$ = parse_packet_data_plaintext(packet_data), command = ref$[0], command_data = ref$[1];
      switch (command) {
      case COMMAND_CREATE_REQUEST:
        this.fire('create_request', {
          address: address,
          segment_id: segment_id,
          command_data: command_data
        });
        break;
      case COMMAND_CREATE_RESPONSE:
        source_id = compute_source_id(address, segment_id);
        if (this._pending_extension_segments.has(source_id)) {
          original_source = this._pending_extension_segments.get(source_id);
          this._pending_extension_segments['delete'](source_id);
          this._extend_response(original_source.address, original_source.segment_id, command_data);
          this._add_segments_forwarding_mapping(address, segment_id, original_source.address, original_source.segment_id);
        } else {
          this.fire('create_response', {
            address: address,
            segment_id: segment_id,
            command_data: command_data
          });
        }
      }
      this.fire('send', {
        address: address,
        packet: packet
      });
    }
    /**
     * @param {Uint8Array}	address1
     * @param {Uint8Array}	segment_id1
     * @param {Uint8Array}	address2
     * @param {Uint8Array}	segment_id2
     */,
    _add_segments_forwarding_mapping: function(address1, segment_id1, address2, segment_id2){
      var source_id1, source_id2;
      source_id1 = compute_source_id(address1, segment_id1);
      source_id2 = compute_source_id(address2, segment_id2);
      this._segments_forwarding_mapping.set(source_id1, [address2, segment_id2]);
      this._segments_forwarding_mapping.set(source_id2, [address1, segment_id1]);
    }
    /**
     * @param {Uint8Array}	address
     * @param {Uint8Array}	segment_id
     */,
    _del_segments_forwarding_mapping: function(address, segment_id){
      var source_id1, ref$, address2, segment_id2, source_id2;
      source_id1 = compute_source_id(address, segment_id);
      if (this._segments_forwarding_mapping.has(source_id1)) {
        ref$ = this._segments_forwarding_mapping.get(source_id1), address2 = ref$[0], segment_id2 = ref$[1];
        source_id2 = compute_source_id(address2, segment_id2);
        this._segments_forwarding_mapping['delete'](source_id1);
        this._segments_forwarding_mapping['delete'](source_id2);
      }
    }
    /**
     * @param {Uint8Array}	address
     * @param {Uint8Array}	segment_id
     * @param {Uint8Array}	packet_data
     */,
    _process_packet_data_encrypted: function(address, segment_id, packet_data){
      var packet_data_header_encrypted, this$ = this;
      packet_data_header_encrypted = packet_data.slice(0, 3 + this._mac_length);
      this._decrypt(address, segment_id, address, packet_data_header_encrypted).then(function(packet_data_header){
        var ref$, command, command_data_length, command_data_encrypted;
        ref$ = parse_packet_data_header(packet_data_header), command = ref$[0], command_data_length = ref$[1];
        command_data_encrypted = packet_data.slice(packet_data_header_encrypted.length, packet_data_header_encrypted.length + command_data_length);
        this$._decrypt(address, segment_id, address, command_data_encrypted).then(function(command_data){
          var next_node_address, segment_creation_request_data, next_node_segment_id, next_node_source_id, e, source_id;
          switch (command) {
          case COMMAND_EXTEND_REQUEST:
            try {
              next_node_address = command_data.subarray(0, this$._address_length);
              segment_creation_request_data = command_data.subarray(this$._address_length);
              next_node_segment_id = this$.create_request(next_node_address, segment_creation_request_data);
              next_node_source_id = compute_source_id(next_node_address, next_node_segment_id);
              this$._pending_extension_segments.set(next_node_source_id, {
                address: address,
                segment_id: segment_id
              });
            } catch (e$) {
              e = e$;
              this$.create_response(address, segment_id, new Uint8Array);
              return;
            }
            break;
          case COMMAND_EXTEND_RESPONSE:
            source_id = compute_source_id(address, segment_id);
            if (this$._pending_extensions.has(source_id)) {
              this$.fire('extend_response', {
                address: address,
                segment_id: segment_id,
                command_data: command_data
              });
            }
            break;
          case COMMAND_DESTROY:
            break;
          case COMMAND_DATA:
            this$.fire('data', {
              address: address,
              segment_id: segment_id,
              command_data: command_data
            });
          }
        });
      })['catch'](function(){
        var source_id, ref$, target_address, target_segment_id, packet;
        source_id = compute_source_id(address, segment_id);
        if (this$._segments_forwarding_mapping.has(source_id)) {
          ref$ = this$._segments_forwarding_mapping.get(source_id), target_address = ref$[0], target_segment_id = ref$[1];
          packet = generate_packet(this$._packet_size, this$._version, target_segment_id, packet_data);
          this$.fire('send', {
            address: target_address,
            packet: packet
          });
        }
      });
    }
    /**
     * @param {Uint8Array}	address			Node at which routing path has started
     * @param {Uint8Array}	segment_id		Same segment ID as returned by CREATE_REQUEST
     * @param {Uint8Array}	target_address	Address for which to encrypt (can be the same as address argument or any other node in routing path)
     * @param {Uint8Array}	plaintext
     *
     * @return {Promise} Will resolve with Uint8Array ciphertext if encrypted successfully
     */,
    _encrypt: function(address, segment_id, target_address, plaintext){
      var data, promise, this$ = this;
      data = {
        address: address,
        segment_id: segment_id,
        target_address: target_address,
        plaintext: plaintext,
        ciphertext: null
      };
      promise = this.fire('encrypt', data).then(function(){
        var ciphertext;
        ciphertext = data.ciphertext;
        if (!(ciphertext instanceof Uint8Array) || ciphertext.length !== plaintext.length + this$._mac_length) {
          throw new Error('Encryption failed');
        }
        return ciphertext;
      });
      promise['catch'](function(){});
      return promise;
    }
    /**
     * @param {Uint8Array}	address			Node at which routing path has started
     * @param {Uint8Array}	segment_id		Same segment ID as returned by CREATE_REQUEST
     * @param {Uint8Array}	target_address	Address from which to decrypt (can be the same as address argument or any other node in routing path)
     * @param {Uint8Array}	ciphertext
     *
     * @return {Promise} Will resolve with Uint8Array plaintext if decrypted successfully
     */,
    _decrypt: function(address, segment_id, target_address, ciphertext){
      var data, promise, this$ = this;
      data = {
        address: address,
        segment_id: segment_id,
        target_address: target_address,
        ciphertext: ciphertext,
        plaintext: null
      };
      promise = this.fire('decrypt', data).then(function(){
        var plaintext;
        plaintext = data.plaintext;
        if (!(plaintext instanceof Uint8Array) || plaintext.length !== ciphertext.length - this$._mac_length) {
          throw new Error('Decryption failed');
        }
        return plaintext;
      });
      promise['catch'](function(){});
      return promise;
    }
  };
  Ronion.prototype = Object.assign(Object.create(asyncEventer.prototype), Ronion.prototype);
  Object.defineProperty(Ronion.prototype, 'constructor', {
    enumerable: false,
    value: Ronion
  });
}).call(this);
