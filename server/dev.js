process.env.NODE_ENV = process.env.NODE_ENV || 'development';
process.env.SERVE_STATIC = process.env.SERVE_STATIC || '1';
process.env.CHESS_REVIEW_DEV_SERVER = process.env.CHESS_REVIEW_DEV_SERVER || '1';

require('./index.cjs');
