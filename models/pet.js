const { Sequelize, DataTypes } = require('sequelize');
const databaseConnectionString = include('/databaseConnectionSequelize');
const sequelize = new Sequelize(databaseConnectionString);
const userModel = include('models/web_user');

const petModel = sequelize.define('pet',
    {
        pet_id: {
            type: Sequelize.INTEGER,
            autoIncrement: true,
            primaryKey: true
        },
        name: { type: Sequelize.STRING, allowNull: false }
    },
    {
        tableName: 'pet',
        timestamps: false
    });

petModel.belongsTo(userModel, {
    as: 'owner', timestamps: false, foreignKey:
        'web_user_id'
});
userModel.hasMany(petModel, {
    as: 'pets', timestamps: false, foreignKey:
        'web_user_id'
});

module.exports = petModel;